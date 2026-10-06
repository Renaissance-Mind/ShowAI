# 外部 ShowAI 运行入口

ShowAI 软件提供 CLI、阅读器、组件编译器和运行依赖；插件只提供 skills 与参考文档。

本会话已验证的启动配置可以直接复用。首次使用按以下顺序定位：用户提供的启动配置；`SHOWAI_HOME` 指向目录内的 `agent-runtime.json`；默认 `~/.showai/agent-runtime.json`。该文件由软件的 `runtime register` 命令或桌面启动登记，包含 `launch.command`、`launch.args`、`launch.env` 和内容目录。按参数数组调用命令，追加本次 CLI 参数，保留环境变量；不要把配置字符串当 shell 代码执行。

用这个入口执行 `runtime info --json`，确认 protocol 为 1、版本至少为 0.7.0，并保留返回的 home 与 guideTopics。桌面程序通过自带运行时启动 CLI；外部 Node 运行方式要求 Node.js 22.12+。配置缺失时，使用桌面“设置 → 连接 Agent”提供的启动配置；缺少可执行软件或版本不匹配时说明实际缺项，不从插件目录猜测程序位置。

以下所有文档中的 `showai` 代表验证后的外部命令前缀。页面和目录写入显式选择项目。首次进入会话调用 `projects current --harness HOST --session ACTUAL_SESSION_ID --json`；无绑定再创建，用户指定复用项目时先列表再选择。没有真实会话 id 时省略绑定。home 与桌面内容库一致；从最新修改时间或全局选中状态推断项目会造成错误编辑。

## 按需披露

技能入口说明意图与决策；静态参考仅在对应工作需要时读。动态信息通过 CLI 查询：

1. `guide TOPIC --json`：本次操作的协议与命令。
2. `catalog list --project PROJECT --kind component|template --query 用途 --limit 8 --json`：摘要筛选。
3. `catalog describe ID --project PROJECT --kind KIND --view guide --json`：所选对象的用途与约定。
4. `--view schema` 或 `examples`：准备输入或需要参考实例时再取。
5. `--view source --file PATH`：开发或改造该对象时才取源码；需要完整包时显式用 `--file '*'`。

已有版本与指纹固定。项目内修改、提升到全局库、准备远端发布是不同操作；只有用户要求共享或发布时再读 `guide versions` / `guide publish`。导出文件不会自动上传。
