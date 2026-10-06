# 外部 ShowAI 运行入口

ShowAI 软件提供 CLI、阅读器、组件编译器和运行依赖；插件只提供 skills 与参考文档。

本会话已验证的启动配置可以直接复用。首次使用按以下顺序定位：用户提供的启动配置；`SHOWAI_HOME` 指向目录内的 `agent-runtime.json`；默认 `~/.showai/agent-runtime.json`。该文件由软件的 `runtime register` 命令或桌面启动登记，包含 `launch.command`、`launch.args`、`launch.env` 和内容目录。按参数数组调用命令，追加本次 CLI 参数，保留环境变量；不要把配置字符串当 shell 代码执行。

用这个入口执行 `runtime info --json`，确认 protocol 为 1、版本至少为 0.7.2，并保留返回的 home 与 guideTopics。桌面程序通过自带运行时启动 CLI；外部 Node 运行方式要求 Node.js 22.12+。配置缺失时，使用桌面“设置 → 连接 Agent”提供的启动配置；缺少可执行软件或版本不匹配时说明实际缺项，不从插件目录猜测程序位置。

需要确认按页打包时检查 `readerCompilation.mode`：`page-dependencies` 表示运行包已携带阅读器源码档案，可在导出时按本页组件编译；`prebuilt` 或缺少该字段表示仍使用预构建阅读器。仅更新 skills 不会升级运行程序。

以下所有文档中的 `showai` 代表验证后的外部命令前缀。home 与用户选定的工作台内容库一致；仓库工作目录、正式内容库与开发测试内容库各有用途，使用启动配置或明确的 `--home` 确定本次写入位置。

## 选择目标项目

用户指定 ShowAI 项目名称、ID 或页面归属时，核对后采用该项目，并通过 `--project PROJECT` 指定。未指定时执行 `projects current --json`；命令按当前工作目录对应的 Git 仓库根目录定位，没有 Git 仓库则使用当前目录。宿主提供明确的项目目录时使用 `projects current --source-directory /absolute/project --json`，直接按该目录定位。

目录会解析为真实绝对路径。同一目录下的多个 Agent session 共用同一 ShowAI 项目；首次使用时自动创建，名称取目录名。返回内容包含内容库路径、项目身份、实际项目目录、定位依据及是否新建。页面、组件、模板和 MCP 省略 `--project` 时使用同样的目录规则；显式项目优先。项目会话绑定不参与默认选择。

检查 `runtime info` 的 `projectResolution.mode` 为 `directory`，确认软件支持该流程。缺少能力时更新 ShowAI 软件运行时；skills 更新不替代软件更新。用户要求独立项目时才显式 `projects create`，后续操作使用返回的项目 ID。

## 按需披露

技能入口说明意图与决策；静态参考仅在对应工作需要时读。动态信息通过 CLI 查询：

1. `guide TOPIC --json`：本次操作的协议与命令。
2. `catalog list --project PROJECT --kind component|template --query 用途 --limit 8 --json`：摘要筛选。
3. `catalog describe ID --project PROJECT --kind KIND --view guide --json`：所选对象的用途与约定。
4. `--view schema` 或 `examples`：准备输入或需要参考实例时再取。
5. `--view source --file PATH`：开发或改造该对象时才取源码；需要完整包时显式用 `--file '*'`。

已有版本与指纹固定。项目内修改、提升到全局库、准备远端发布是不同操作；只有用户要求共享或发布时再读 `guide versions` / `guide publish`。导出文件不会自动上传。
