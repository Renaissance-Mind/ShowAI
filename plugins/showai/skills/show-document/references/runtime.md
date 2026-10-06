# 外部 ShowAI 运行入口

ShowAI 软件提供 CLI、阅读器、组件编译器和运行依赖；插件只提供 skills 与参考文档。

本会话已验证的启动配置可以直接复用。首次使用按以下顺序定位：用户提供的启动配置；`SHOWAI_HOME` 指向目录内的 `agent-runtime.json`；默认 `~/.showai/agent-runtime.json`。该文件由软件的 `runtime register` 命令或桌面启动登记，包含 `launch.command`、`launch.args`、`launch.env` 和内容目录。按参数数组调用命令，追加本次 CLI 参数，保留环境变量；不要把配置字符串当 shell 代码执行。

用这个入口执行 `runtime info --json`，确认 protocol 为 1、版本至少为 0.7.2，并保留返回的 home 与 guideTopics。桌面程序通过自带运行时启动 CLI；外部 Node 运行方式要求 Node.js 22.12+。配置缺失时，使用桌面“设置 → 连接 Agent”提供的启动配置；缺少可执行软件或版本不匹配时说明实际缺项，不从插件目录猜测程序位置。

需要确认按页打包时检查 `readerCompilation.mode`：`page-dependencies` 表示运行包已携带阅读器源码档案，可在导出时按本页组件编译；`prebuilt` 或缺少该字段表示仍使用预构建阅读器。仅更新 skills 不会升级运行程序。

以下所有文档中的 `showai` 代表验证后的外部命令前缀。home 与用户选定的工作台内容库一致；仓库工作目录、正式内容库与开发测试内容库各有用途，使用启动配置或明确的 `--home` 确定本次写入位置。

## 选择目标项目

`projects current --harness HOST --session ACTUAL_SESSION_ID --json` 查询当前 Agent 会话的绑定。`bound: false` 表示尚未建立绑定，接下来查询 `projects list --json` 发现已有内容。所有页面和项目目录写入显式指定 `--project`。

用户指定项目名称/id、页面归属或“当前项目”时，先核对并采用该目标。用户明确 @ShowAI 桌面应用或要求在当前工作台创作时，可用宿主的应用/浏览器读取能力查看实际可见的项目，再用 CLI 列表核对名称、id 与内容目录；核对失败时保留待确认目标。读取可见界面是当前任务的上下文查询；后台保存的全局选择、最近修改时间和代码目录不用于推断写入目标。

目标已明确就用 `projects bind PROJECT --harness HOST --session ACTUAL_SESSION_ID --json` 建立或切换绑定。没有新的用户目标时沿用已有绑定。既无明确目标也无绑定时，只有一个可用项目就复用；多个候选时让用户选择，可先继续独立的材料调研。用户要求独立项目，或列表为空时再创建。

使用真实会话 id；宿主未提供时省略绑定，在对话保留已选项目 id。新建、提取或验证模板和开发组件也沿用这个已选项目。

## 按需披露

技能入口说明意图与决策；静态参考仅在对应工作需要时读。动态信息通过 CLI 查询：

1. `guide TOPIC --json`：本次操作的协议与命令。
2. `catalog list --project PROJECT --kind component|template --query 用途 --limit 8 --json`：摘要筛选。
3. `catalog describe ID --project PROJECT --kind KIND --view guide --json`：所选对象的用途与约定。
4. `--view schema` 或 `examples`：准备输入或需要参考实例时再取。
5. `--view source --file PATH`：开发或改造该对象时才取源码；需要完整包时显式用 `--file '*'`。

已有版本与指纹固定。项目内修改、提升到全局库、准备远端发布是不同操作；只有用户要求共享或发布时再读 `guide versions` / `guide publish`。导出文件不会自动上传。
