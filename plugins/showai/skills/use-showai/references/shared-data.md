# 共享数据

多个页面、多个组件需要同时读写同一份数据时（例如「全景」的目标看板和「日程」表格都要显示和修改同一批截止日期），把数据放进项目的共享数据（dataset），让这些组件绑定它。不要再用脚本把数据复制到另一个页面：复制出的副本会和原数据分叉。完整说明用 `guide({topic:"datasets"})` 读取。

先确认 `showai_capabilities` 返回 `datasets.protocol` 为 `showai-datasets-v1`；没有时说明当前 ShowAI 运行时还不支持共享数据、需要更新，不要改用复制或脚本。下面每个项目工具都显式传 `projectId`。

## 模型

- 共享数据是项目里的一个独立资源，保存一份 JSON 值，有自己的 hash 和 revision；写入只需传读到的 `baseHash`。读写用 `dataset_read`（list / read）、`dataset_write`（create / apply / link）与 `dataset_delete`。`dataset_read` 同时返回本项目中使用它的页面与块（`references`）。值也可以放在内容库以外的文件里，见下文「外部文件中的数据」。
- 组件块通过 `data.$binding` 绑定共享数据。页面只保存绑定设置和这个块自己的值；共享数据变化不会改变页面的 hash，页面的保存冲突也不涉及共享数据。
- 组件照常收到 `{data, onChange, readOnly}`，不需要任何新接口。宿主从共享数据生成组件参数，把 `onChange` 交回的整份参数按记录 id 拆成对共享数据的修改。组件要满足两点：列表条目有稳定 `id`，收到新的 `data` 时以它为准，见 [组件设计](../../create-component/references/component-authoring.md)。

## 两种绑定

**props**：共享数据（或其中 `path` 指向的对象）就是组件的顶层参数，`local` 列出的参数留在各块自己保存（如标题、视图设置）。把已有组件的数据变成共享数据：

```text
dataset_write({projectId, action:"create", name:"全景 OKR", fromBlock:{pageId, blockId, baseHash, baseRevision, local:["title"]}})
```

它在同一次保存里创建共享数据并把该块改为绑定；当时那个组件版本的参数 schema 会随之约束此后对共享数据的每次写入。组件升级后参数结构有变化时，用 `dataset_write` apply 的 `schema` 换成新版本的约束（`null` 取消约束）。已有数据的列表缺 id 时，先在源组件里补上 id 再共享。另一个块要显示同一份数据时，用 `page_apply` 的 `{type:"component.binding.set", blockId, binding:{dataset:ID, props:{local:[...]}}}`。

**collections**：把共享数据里沿某条路径找到的记录，作为某个数组参数（如表格的 `rows`）的条目，排在块自己的条目之后，按来源中的顺序排列（表格排序和日历按各自规则显示）。下面是 `component.binding.set` 的 `binding` 参数。下面的字段名（`objectives`、`due`、`done`、`areas`、表格的列 id）只是示例，要换成实际的组件参数和表格列；写回的值必须符合来源字段的类型与格式（例如日期是 `YYYY-MM-DD` 文本）：

```json
{
  "dataset": "DATASET_ID",
  "collections": [
    {
      "key": "task",
      "into": "rows",
      "from": "objectives[*].keyResults[*].tasks[*]",
      "where": { "field": "due", "exists": true },
      "label": "全景 · 任务",
      "fields": {
        "title": "title",
        "date": { "from": "due", "empty": "remove" },
        "done": "done"
      },
      "derived": {
        "project": "../../title",
        "cat": { "lookup": "areas", "by": "../../area", "field": "name" },
        "source": { "template": "全景 · {../title}" }
      },
      "defaults": { "kind": "截止" }
    }
  ]
}
```

- 条目 id 是 `key:记录id`（如 `task:t1`）。同一 key 下记录 id 重复时改为 `key:各层id用/连接`（如 `task:o1/k1/t1`）。没有 id 的记录以 `#序号` 代替并且只读，只能在来源修改。
- `fields` 把显示字段对应到记录自己的字段，修改会写回记录。对象写法支持 `map`（显示值 → 保存值）、`otherwise`（保存值不在 map 中时显示的值）和 `empty`（清空时 `remove` 删除该字段，`keep` 保存空字符串；可选日期用 `remove`）。例如 `{"from":"status","map":{"true":"done","false":"todo"},"otherwise":false}` 把勾选对应到状态；注意取消勾选会把状态写成 `todo`，原来的中间状态（进行中、有风险等）不会保留，必要时先和用户确认。
- `derived` 只读：`../title` 表示上一层记录的字段，`{value}` 是常量，`{template}` 拼接文字，`{lookup, by, field}` 按 id 在别处查名字。
- 其他字段（包括 `defaults`）由这个块按条目保存在 `$binding.overlay`，例如日程里的「开始准备」「确认」。
- 多条 collection 可以填同一个 `into`（任务、关键目标、目标都进日程）。块自己的条目（手填行）不受影响。
- 映射来的条目不能在表格里删除或改派生字段；这样的修改会被拒绝并说明原因，不会悄悄丢掉。清空映射的日期会从来源删除日期，条目随之离开日程。

两种绑定可以同时使用。

## 读写

- `page_read` 的结构化、markdown 和大纲结果都带 `bindings`（`response:"source"` 也保留，`"receipt"` 省略）：每个绑定块的共享数据 id、hash、解析后的参数 `props`、映射条目数 `mapped`、每个映射条目对应的来源路径 `sources` 和提示 `issues`。图像、html 视图按共享数据显示。
- 每次 `page_read` 或 `dataset_read` 都会记住本会话读到的版本；之后带 baseHash 的写入以它为起点，与期间别处的修改合并。写入和读取不在同一个 Agent 会话（不同的对话或连接）时，给 `page_apply` 传 `datasetBases:{共享数据id: 读到的hash}`。
- 选择写法：修改页面上看到的一行（包括只属于这个块的字段，如开始准备），对绑定块用 `component.props.set`，按读取到的形式传参数（例如包含映射行的完整 `rows`）：映射字段写入共享数据，其他字段写入块，二者在同一次保存中完成。直接改来源记录（尤其是多条、嵌套或不在页面上显示的字段）用 `dataset_write({projectId, action:"apply", datasetId, baseHash, operations})`：`{op:"set",path,value}`、`{op:"remove",path}`、`{op:"insert",path:列表,value,after?}`、`{op:"move",path:条目,after}`。路径按 id 选记录，例如 `objectives[id=o1].keyResults[id=k1].tasks[id=t1].due`，或 `["objectives",{"id":"o1"},…]`；映射条目的完整路径取自 `bindings[].sources`。
- 两种写法遇到同一字段的新修改都返回 CONFLICT 并且什么都不写，见下文。`page_apply` 返回的 CONFLICT 带 `details.datasetId` 与 `details.conflicts` 时是共享数据冲突：重新 `page_read` 后逐项决定，不走 `page_diff` 和整页合并；没有这些字段时是页面本身的保存冲突。
- `page_save` 不能把共享参数写进绑定块；要改这些参数用上面两种方式。
- 解除绑定：`{type:"component.binding.remove", blockId, keep:"snapshot"}` 把当前显示的参数存为块的副本。
- 删除：先用 `dataset_read` 的 `references` 查看本项目里使用它的页面，向用户确认（删除不能在应用中撤销）。`dataset_delete({projectId, datasetId, baseHash})` 只删除没有块使用的共享数据，已移到其他项目、仍指向它的页面也算在内；仍有使用时返回 `details.references`（每项带 projectId、pageId、blockIds）而不删除，由用户决定是否先在这些块上解除绑定：读取对应项目的页面后用 `component.binding.remove`。

## 并发与冲突

每次写入都带着它开始时的值。不同记录、同一记录的不同字段可以同时修改，自动合并；两处把同一字段改成不同的值才是冲突：写入返回 CONFLICT、什么都不写，`details.conflicts` 给出每个字段的 `path`、`base`、`mine`、`theirs`。重新读取，把每个字段的 `base`、`mine`、`theirs` 告诉用户，由用户决定保留哪个（意图明确时按用户这次的要求），再用新的 baseHash 写入；不要用旧读取的整份值覆盖。没有 id 的列表只能整体替换，几处同时改它会冲突，所以多人编辑的列表条目要有稳定 id。顺序调整按最后一次为准，不丢内容。

用户说应用里出现冲突提示时，先用 `page_read` 看该块是否在 `bindings` 中：是共享数据就按本节处理；不是则属于页面保存冲突，按 use-showai 的编辑与验证处理。工作台里的共享数据冲突留在出现冲突的那个窗口：组件上方列出「此处的修改」和「另一处的修改」，由使用者选择保留哪一个。「此处的修改」是这个窗口尚未保存的值，保存在该窗口的本地草稿里（不在 `draft_read` 列出的草稿中）；「另一处的修改」是已经保存的值。Agent 用 `dataset_read` 只能看到已保存的值，看不到窗口里未保存的那个值，也清除不了这个提示，需要请用户说出想保留的内容。用户问起时解释含义，读取已保存的值告诉用户；用户希望保留的值由 Agent 写入时，在确认后用 `dataset_write` 的 apply 写入，再请用户在该窗口点「采用另一处的」关闭提示（此时另一处就是刚写入的值）。

## 把复制改成共享

1. 核对组件：用 `catalog_describe` 的 parameters 查看各层列表是否有唯一 `id`，用 development/source 确认组件按收到的 `data` 渲染。不满足时先说明，或按 [组件设计](../../create-component/references/component-authoring.md) 更新组件。
2. 认出副本：复制进来的行通常带同步脚本使用的 id 前缀或来源说明，能对应到来源记录 id。无法确定时按标题与日期匹配，把匹配结果列给用户确认，不要猜。
3. 比较副本和来源：副本的日期、完成或标题与来源不同时，说明是在目标页面改过。把差异列给用户，确定每一处保留哪一边。
4. 在源页面用 `dataset_write` create 的 `fromBlock` 把源组件改为共享数据（或在工作台的块菜单选「共享数据…」），再用 `dataset_write` 的 apply 写入用户决定保留的目标页面的值。
5. 在目标页面对表格用 `component.binding.set` 设置 collections 映射；`page_read` 看 `bindings[].mapped`、`sources` 和 `issues` 核对条目数量与列名。
6. 处理副本行：取 `bindings[].props.rows`，把副本行里只在目标页面填写的字段（如开始准备、确认、类型）抄到对应的映射行，去掉副本行，保留手填行，用一次 `component.props.set({rows})` 保存。这些字段进入 `$binding.overlay`，副本行从块中删除。
7. 与用户一起停用原来的同步脚本，再读取两页核对一致。

## 外部文件中的数据

用户的数据已经在内容库以外的目录（脚本生成的 JSON、表格导出的 CSV 等），或希望数据留在某个目录里由其他工具一起维护时，用 `dataset_write` 的 link 让共享数据直接读写那个文件，而不是复制进项目。先确认 `showai_capabilities.datasets.externalFiles.available`；为 false（远程连接或旧版运行时）时说明当前连接不能链接本机文件，请用户在本机 ShowAI 中操作或更新运行时，不要改成把文件复制进页面。

- 文件格式按扩展名：`.json` 保存任意 JSON 值；`.csv`、`.tsv` 读成 `{columns, rows}`，第一行是列名，单元格读成文字、数字或 true/false。CSV/TSV 只能保存这种表格结构，嵌套值会被拒绝。文件必须是 UTF-8 文本；中文版 Excel 默认的「CSV」是 GBK，会以 INVALID_DATA 拒绝读取，请用户另存为「CSV UTF-8」。Excel 打开期间保存的文件会在下次读取时出现；它可能改写日期和数字格式，写回的值以文件中实际的文字为准。
- 表格要有 `id` 列，表格组件中的修改才能写回对应行；绑定表格时用 collections 的 `from:"rows[*]"`。读取后 `columns` 没有 `id` 时告诉用户：没有 id 的行在组件里只读，只能在原文件中修改。用户同意由 Agent 补上时，读出 rows，为每行加上稳定的 id，用 `dataset_write({projectId, action:"apply", datasetId, baseHash, operations:[{op:"set", path:"rows", value:新rows}]})` 一次写回（这会改写整个文件，先确认文件没有其他程序正在编辑）；或者请用户在原工具里加一列 id。
- 从已有文件新建：`dataset_write({projectId, action:"link", name, path:"/绝对路径/schedule.csv"})`。把项目里已有的共享数据移到新文件：`dataset_write({projectId, action:"link", datasetId, path, use:"dataset"})`，目标文件必须还不存在；已存在时返回 CONFLICT、什么都不写，请用户换一个文件名，或在确认要以该文件内容替换共享数据后改用 `use:"file"`。用一个已有文件替换共享数据的值：`use:"file"`（两边都有数据时必须写明，替换前与用户确认）。已链接的外部数据在另一台设备上只需 `dataset_write({projectId, action:"link", datasetId, path})` 链接本机的那份文件。链接永远不会覆盖已有文件。路径必须是绝对路径，`~` 要展开成实际的主目录。
- 只链接用户指明的文件，不猜路径，也不链接内容库内部的文件。路径只记录在这台设备上，文件内容也不随项目同步。项目在其他设备打开时，那里会返回 `SOURCE_UNAVAILABLE`（`details.source` 带格式和文件名），`dataset_read` 的 list 标出 `source.available:false`，绑定块显示「共享数据「名称」读取外部文件「文件名」，这台设备还没有链接它。」和「链接文件…」按钮；链接过但文件读不到时显示「……现在无法读取」并给出路径。向用户说明：先把文件放到这台设备上（同步盘、拷贝等），再由用户点「链接文件…」选择它，或告诉 Agent 文件的绝对路径后用 `dataset_write({projectId, action:"link", datasetId, path})` 链接。文件格式必须与原来相同。没有这份文件时数据无法恢复，`path:null` 也需要能读到文件。
- 读写与项目内的共享数据相同：每次读取都读文件，每次写入都原子地写回文件并保留原来的缩进、换行和引号；文件在别处被修改后，打开的窗口会更新，基于旧读取的写入按记录和字段合并。文件读取后又被改动时写入返回 CONFLICT，重新读取后再写。文件不可读或内容不符合 schema 时返回 `SOURCE_UNAVAILABLE` 并说明原因。
- `dataset_write({projectId, action:"link", datasetId, path:null})` 把文件当前内容复制回内容库并停止读写该文件；`dataset_delete` 只删除共享数据和链接。两者都保留文件本身。
- 导出（html、inline、site 和工作台导出的页面源）会把外部数据作为快照写进导出文件。这样的导出先返回 `CONFIRMATION_REQUIRED`，什么也不写：`details.externalSnapshots` 列出每份外部数据的名称、文件、文件大小、写入导出的快照字节数（`snapshotBytes`）和使用它的块，以及合计。把这些告诉用户，说明快照不会随文件更新、收到导出文件的人能看到这些数据；用户同意后再用 `externalData:"embed"` 重新导出。`available:false` 表示文件现在读不到，导出后这些块不显示数据。用户不同意时不导出这些数据：可以用 `blockIds` 只导出不含这些块的部分（报告只统计选中的块），或不导出。
- `page_present` 在对话里展示当前数据，不需要确认；但它的 delivery 文件（delivery.html 等）同样带着这些数据，结果中的 `externalSnapshots` 列出大小。只在对话中展示时无需询问；要把 delivery 文件交给别人或上传时，先按上一条告诉用户并取得同意；之前生成的 delivery 可能已过时，交付前重新 page_present 或改用 page_export 得到当前快照。

## 其他

共享数据和组件参数一样最大 8 MiB，外部文件也一样。导出、图像与 board_read 使用导出或渲染那一刻的最新数据快照；导出文件不再含绑定。页面移到其他项目后仍读原项目的共享数据（`binding.project`）。存为模板时，绑定块保存为当前数据的副本。项目同步按记录和字段合并两台设备的修改；无法合并的字段保留两份并生成说明页。
