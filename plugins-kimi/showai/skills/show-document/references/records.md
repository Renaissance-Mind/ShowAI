# 工作记录与结构检查

制作正式作品时，每个环节交出的记录写成文件，供续改、评审和提炼模板时使用。

## 记录目录与文件

`showai_capabilities.authoring.workRecords.available` 为 true 时，记录目录是它返回的 directory：默认在系统临时目录，用户可以在「设置 → 通用」改成固定目录。

每份作品新建一个文件夹 `<directory>/<YYYYMMDD-HHmm>-<作品短名>-<8 位随机十六进制>/`，随机部分保证每次都不同。文件夹里放：

- `brief.md`：读者简报。
- `material.md`：材料底稿，省略材料环节时不建。
- `presentation-plan.json`：顶层写 `reader`、`startingKnowledge`、`goal`（各一句，详细内容在 `brief.md`）、`cutoff`（材料检索截止日期；省略材料环节时写当天日期）、`environment` `{width,height,interactive}`、`nodes`（呈现规划）和 `scenes`（设计稿）；每个节点（包括上级节点）都要出现在某一幕的 `nodes` 里。只要规划或设计稿时顶层写 `title`，以后没有 `pageId` 也能按标题找到。建页后补上 `projectId` 与 `pageId`，制作后为各幕填入 `blockIds`。
- `review.md`：评审发现、修订与未验证项；以后续改时在末尾追加。

## 结构检查脚本

设计稿完成、第一次写入页面之前，运行：

```sh
python3 <show-document Skill 目录>/scripts/check_plan.py <规划路径>
```

检查规划与设计稿的结构覆盖。评审时把 `page_read({response:"source"})` 的完整结果存进同一文件夹，再加 `--page <页面源>` 检查各幕的 `blockIds`。宿主不能运行脚本时手工核对同样的关系并说明。脚本只检查结构，不证明内容讲清楚了。

## 续改与简化情形

- **续改已有作品**：先 `page_read({projectId,pageId,rendered:false,response:"source"})` 读回原 Page，取它的 `templateContext`（源超过 256 KiB 的大页这样读只返回大纲窗口，要取 `templateContext` 时加 `detail:"full"`，本机连接也可用 `out` 写入文件再读），并在记录目录中查找 `presentation-plan.json` 里写有这个 `pageId` 的记录；找到就沿用其中的读者简报、规划和设计稿，只重做受影响的部分；找不到时从页面本身和用户说明反推，新建一个记录文件夹：`brief.md` 标明内容是反推的，`presentation-plan.json` 只为本次要改的部分写节点和幕（含现有块的 `blockIds`），`check_plan` 与评审以这部分为准。
- **局部小改**：只改一两处措辞、数字或样式的局部小改不新建记录，有原记录时在它的 `review.md` 追加一行；改动涉及讲解顺序、增删部分或重做画面时按续改处理。
- **无本机记录目录**：`workRecords.available` 为 false 时（例如远程连接）不落盘，记录写在对话里，交付时说明。几句话就能写完的简单任务，可以只写一个 `brief.md` 或写在对话里。
- **存储边界**：记录是这台设备上的工作材料，不随页面同步或导出；交付时告诉用户记录文件夹的位置。
