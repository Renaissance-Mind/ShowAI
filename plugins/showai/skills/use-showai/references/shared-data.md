# 共享数据

多个页面、多个组件需要同时读写同一份数据时（例如「全景」的目标看板和「日程」表格都要显示和修改同一批截止日期），把数据放进项目的共享数据（dataset），让这些组件绑定它。不要再用脚本把数据复制到另一个页面：复制出的副本会和原数据分叉。完整说明用 `guide({topic:"datasets"})` 读取。

## 模型

- 共享数据是项目里的一个独立资源，保存一份 JSON 值，有自己的 hash 和 revision。读写用 `dataset_list`、`dataset_read`、`dataset_create`、`dataset_apply`、`dataset_delete`。
- 组件块通过 `data.$binding` 绑定共享数据。页面只保存绑定设置和这个块自己的值；共享数据变化不会改变页面的 hash，页面的保存冲突也不涉及共享数据。
- 组件照常收到 `{data, onChange, readOnly}`，不需要任何新接口。宿主从共享数据生成组件参数，把 `onChange` 交回的整份参数按记录 id 拆成对共享数据的修改。

## 两种绑定

**props**：共享数据（或其中 `path` 指向的对象）就是组件的顶层参数，`local` 列出的参数留在各块自己保存（如标题、视图设置）。把已有组件的数据变成共享数据：

```json
dataset_create({projectId, name:"全景 OKR", fromBlock:{pageId, blockId, baseHash, baseRevision, local:["title"]}})
```

它在同一次保存里创建共享数据并把该块改为绑定；自定义组件的参数 schema 会随之约束此后对共享数据的每次写入。另一个块要显示同一份数据时，用 `page_apply` 的 `{type:"component.binding.set", blockId, binding:{dataset:ID, props:{local:[...]}}}`。

**collections**：把共享数据里沿某条路径找到的记录，作为某个数组参数（如表格的 `rows`）的条目，排在块自己的条目之后：

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

- 条目 id 是 `key:记录id`（如 `task:t1`）；同一 key 下记录 id 重复时改用整条 id 路径。
- `fields` 把显示字段对应到记录自己的字段，修改会写回记录。对象写法支持 `map`（显示值 → 保存值，例如 `{"true":"done","false":"todo"}` 把勾选对应到状态）、`otherwise`（保存值不在 map 中时显示的值）和 `empty`（清空时 `remove` 删除该字段，`keep` 保存空字符串；可选日期用 `remove`）。
- `derived` 只读：`../title` 表示上一层记录的字段，`{value}` 是常量，`{template}` 拼接文字，`{lookup, by, field}` 按 id 在别处查名字。
- 其他字段（包括 `defaults`）由这个块按条目保存在 `$binding.overlay`，例如日程里的「开始准备」「确认」。
- 多条 collection 可以填同一个 `into`（任务、关键目标、目标都进日程）。块自己的条目（手填行）不受影响。
- 映射来的条目不能在表格里删除或改派生字段；这样的修改会被拒绝并说明原因，不会悄悄丢掉。清空映射的日期会从来源删除日期，条目随之离开日程。

两种绑定可以同时使用。

## 读写

- `page_read` 的 `bindings` 列出每个绑定块的共享数据 id、hash 和解析后的参数；markdown、图像、html 视图都按共享数据显示。这次读取会被记住，之后的写入据此合并。
- 对绑定块用 `component.props.set` 时，按读取到的形式传参数（例如包含映射行的完整 `rows`）：映射字段写入共享数据，其他字段写入块，二者在同一次保存中完成。在另一个会话读取的，传 `datasetBases:{共享数据id: hash}`。
- 直接修改共享数据用 `dataset_apply({datasetId, baseHash, operations})`：`{op:"set",path,value}`、`{op:"remove",path}`、`{op:"insert",path:列表,value,after?}`、`{op:"move",path:条目,after}`。路径按 id 选记录：`objectives[id=o1].keyResults[id=k1].tasks[id=t1].due`，或 `["objectives",{"id":"o1"},…]`。
- `page_save` 不能把共享参数写进绑定块；要改这些参数用上面两种方式。
- 解除绑定：`{type:"component.binding.remove", blockId, keep:"snapshot"}` 把当前显示的参数存为块的副本。`dataset_delete` 只能删除没有块使用的共享数据，否则返回 `details.references`。

## 并发与冲突

每次写入都带着它开始时的值。不同记录、同一记录的不同字段可以同时修改，自动合并；两处把同一字段改成不同的值才是冲突：`dataset_apply` 返回 CONFLICT、什么都不写，`details.conflicts` 给出每个字段的 `path`、`base`、`mine`、`theirs`。重新读取，逐项决定后用新的 baseHash 写入；不要用旧读取的整份值覆盖。工作台里冲突的两边都保留并显示在组件上方，由使用者选择。没有 id 的列表只能整体替换，几处同时改它会冲突，所以多人编辑的列表条目要有稳定 id。顺序调整按最后一次为准，不丢内容。

## 把复制改成共享

1. 在源页面用 `dataset_create` 的 `fromBlock` 把源组件改为共享数据（或在工作台的块菜单选「共享数据…」）。
2. 在目标页面对表格用 `component.binding.set` 设置 collections 映射；先 `page_read` 看 `bindings[].mapped` 和 `issues` 核对条目数量与列名。
3. 之前复制进来的行：重新 `page_read`，取 `bindings[].props.rows`；把副本行里只在目标页面填写的字段（如开始准备、确认、类型）抄到对应的映射行（按来源记录 id 找到 `task:…` 等新条目），从列表中去掉副本行，保留手填行，再用一次 `component.props.set({rows})` 保存。这些字段会进入 `$binding.overlay`，副本行从块中删除。
4. 停用原来的同步脚本，再读取两页核对一致。

## 其他

共享数据和组件参数一样最大 8 MiB。导出、图像与 board_read 使用保存时刻的数据快照；导出文件不再含绑定。页面移到其他项目后仍读原项目的共享数据（`binding.project`）。存为模板时，绑定块保存为当前数据的副本。项目同步按记录和字段合并两台设备的修改；无法合并的字段保留两份并生成说明页。
