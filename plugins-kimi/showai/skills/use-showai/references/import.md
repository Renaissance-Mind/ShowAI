# 导入与导入器

用户要把其他应用里的内容搬进 ShowAI（Notion 导出、Word 文档、Markdown 文件夹），或者希望以后能导入某种新格式时，读这份说明。完整规则用 `guide({topic:"import"})` 读取。

## 导入

导入先给计划，确认后才写入。本机连接把文件、文件夹或 zip 的绝对路径交给 `page_create` 的 `import`；远程连接读不到用户设备上的文件，请用户在 ShowAI 应用里用「导入文件…」或把文件拖进项目目录。

```text
page_create({projectId, parentId?, import:{source:"/Users/me/Downloads/Export-abc.zip", dryRun:true}})
```

`dryRun:true` 只返回计划：选中的导入器（`importer`，以及各导入器的匹配分数 `candidates`）、目标位置、将创建的文件夹、页面、数据库和附件数量（`counts`），以及全部提示（`warnings`）。提示说明哪些内容保留为文字、哪些链接指向导出范围以外、哪些文件没有页面引用、哪些行列超出数据库上限。把计划告诉用户，用户同意后去掉 `dryRun` 再调用一次。

导入按文件夹、共享数据、页面的顺序写入，每个页面单独保存：一个页面要么完整写入，要么没有写入。回执的 `created` 是实际创建的数量，`problems` 逐项列出没有写入的内容和原因，`openPageId` 是适合先打开的页面，`folderId` 是装下整次导入的文件夹（只有一项顶层内容时为 null）。

撤销整次导入时，用 `organization_update` 把 `undo.folders` 中的文件夹（`update_folder`，`archived:true`）和 `undo.pages` 中的页面（`update_page`，`archived:true`）删除；文件夹里的页面随文件夹一起进入回收站，不必逐页删除，之后可以从「已删除」恢复。数据库背后的共享数据不进回收站，撤销时保留，页面恢复后数据库仍然完整；用户明确要求彻底删除时，先告诉用户 `dataset_delete` 无法撤销，再按 [共享数据](shared-data.md) 处理。回执已经不在对话里时，用 `organization_read` 或 `pages_list` 按导入时的文件夹名和页面标题找到这些内容，请用户确认后再删除。

内置导入器：

- **notion**：Notion「Markdown & CSV」导出的 zip（含嵌套的 Part zip）或解压后的文件夹，普通 Markdown 文件夹也可以。有子页面的页面变成一个文件夹，里面是这个页面和它的子页面；页面之间的链接（相对路径或 notion.so 地址）改成 ShowAI 页面链接；每个 CSV 数据库变成绑定共享数据的数据库组件，列类型按内容推断（多选成为 multiSelect 列；一个关联列里的每个值都是导出中某一个数据库的行页面时（例如 Projects 的 Tasks 列指向 Tasks 数据库的行），这一列成为指向那个数据库、保存记录 id 的 relation 列；值指向普通页面或分散在几个数据库时保留相关页面的标题，并在计划的提示里说明。Notion 的双向关联在导出里两边各有一列，导入后两边各是一个 relation 列，不另加 reverse。公式和汇总保留导出时的计算结果），行页面通过 page 列连接；图片、视频、音频和 PDF 附件在资源上限内嵌入页面。
- **word**：.docx 文档，保留标题、粗体、斜体、下划线、删除线、代码、链接、多级列表、含合并单元格的表格、图片和脚注；批注不属于页面内容，会在提示中列出。
- **markdown**：.md、.markdown、.txt 以及 ShowAI 导出的 .html、.showai.json，每个文件一页。

不指定 `importer` 时使用匹配分数最高的导入器；用户指定格式时传 `importer`。

## 新增导入器

用户需要导入一种还不支持的格式时，写一个导入器保存到项目里，不需要修改 ShowAI 本身。保存后，这个项目的「导入文件…」、拖入文件和 `page_create` 的导入都会用到它；其他项目要用时，请用户在终端运行 `showai importers save 导入器文件夹 --scope global`，把它保存到整个内容库。导入器由两部分组成：

- `importer.json`：`{format:"showai-importer", id, name, version, description, extensions:[".opml"], folders?}`。`extensions` 决定文件对话框和拖入时接受哪些文件，`folders:true` 表示也读取文件夹和 zip。
- `importer.js`：在和共享数据处理脚本相同的 QuickJS 沙箱里运行，没有文件、网络、计时器和宿主对象，上限是 256 MiB 内存、20 秒和 64 MiB 输出。脚本定义 `function convert(input)`，可选 `function detect(input)` 返回 0 到 1 的匹配分数。`input` 是 `{name, kind, files:[{path, size, text?}]}`；UTF-8 文本文件带 `text`（单个 4 MiB、合计 32 MiB 以内），`detect` 收到的文件不带 `text`。沙箱里没有 XML、HTML 或 CSV 解析器，用字符串方法和正则表达式读取文本。

`convert` 返回和内置导入器相同的结构：

```json
{
  "title": "可选：多项内容外层文件夹的名称",
  "folders": [{ "key": "f1", "title": "文件夹" }],
  "pages": [
    {
      "key": "p1",
      "title": "页面",
      "parent": "f1",
      "blocks": [
        { "kind": "text", "data": { "format": "markdown", "content": "见 [另一页](showai-import:page/p2)" } },
        { "kind": "image", "data": { "src": "showai-import:file/images%2Fa.png", "alt": "示意图" } }
      ]
    }
  ],
  "datasets": [{ "key": "d1", "name": "数据", "value": { "columns": [], "rows": [] } }],
  "warnings": [{ "source": "a.opml", "message": "保留为文字的内容" }]
}
```

`blocks` 就是 `page_create` 的 blocks：目录里的任何组件都可以作为目标，包括自定义组件，保存时按各组件的参数契约检查。引用写成占位符，导入时替换：`showai-import:page/KEY` 换成页面链接（Markdown 链接里同样有效），`showai-import:folder/KEY` 换成文件夹 id（例如数据库 page 列的 folder），`showai-import:dataset/KEY` 换成共享数据 id（例如 `$binding.dataset`），`showai-import:file/PATH` 把输入里的图片、视频、音频或 PDF 嵌入为 data URL。KEY 和 PATH 用 `encodeURIComponent` 编码；引用不存在的内容时留空并写入提示。

保存和管理：

```text
catalog_version({projectId, action:"importer", manifest:{…importer.json…}, script:"…importer.js…"})
catalog_list({projectId, kind:"contribution"})   // slots[slot=importer].filledBy 列出内置与项目里的导入器
catalog_describe({projectId, id:"opml", kind:"importer"})
catalog_version({projectId, action:"remove", kind:"importer", id:"opml"})
```

保存同一个 id 会替换原导入器，内容库历史保留旧版本。保存后先用一份真实的样例文件 `dryRun`，核对计划里的页面、数量和提示，再告诉用户可以在应用里导入这种文件。项目里的导入器优先于整个内容库里同 id 的导入器，内置导入器的 id（notion、word、markdown）不能占用。
