# MCP 连接配置

本文件用于宿主接入、连接错误或切换内容库。普通 Agent 文档操作始终使用已连接的 MCP 工具，不先执行 CLI 文档命令。

## 本机插件

本地插件的 `mcp.json` 启动 `mcp/launch.mjs`。启动器读取宿主指定的 `SHOWAI_HOME`，未指定时使用当前用户的 `~/.showai`，再读取该库的 `agent-runtime.json`。`SHOWAI_RUNTIME_CONFIG` 可显式指定配置文件，但其中 home 必须与选定库一致；出错时不搜索其他库。

启动器只用 CLI 做 runtime info 能力探测和启动 MCP。运行时必须声明 `capabilities.agentOperations.protocol=showai-mcp-v1`。缺少时需要更新并登记目标 ShowAI 软件；更新 Skill 不会更新软件。插件本身不包含文档编译运行时。本机需要 Node.js 22.12+ 和已登记的 ShowAI 软件。

可由宿主设置：

| 配置                    | 作用                                                       |
| ----------------------- | ---------------------------------------------------------- |
| SHOWAI_HOME             | 明确的本机内容库                                           |
| SHOWAI_RUNTIME_CONFIG   | 该库对应的运行入口配置                                     |
| SHOWAI_PROJECT_ID       | 可选，锁定一个已存在的项目；省略则由工具显式选择项目       |
| SHOWAI_PRESENTATION_DIR | 可选，宿主允许的绝对展示输出目录；否则由运行时分配预览目录 |

项目绑定连接还可设置 `SHOWAI_TEMPLATES`（格式 `ID[@VERSION],ID`）作为该会话的默认模板选择，必须同时设置 `SHOWAI_PROJECT_ID`；内容库连接在每次任务用 template_context 显式选择模板。

对话预览默认携带压缩的本地阅读器；超出聊天预算时，才回退到已发布的 CDN 阅读器。紧凑片段、在线页和显式 `reader:"cdn"` 导出依次从 ShowAI 阅读器源（reader.showai.renaissancemind.ai）、jsDelivr、unpkg 加载阅读器。宿主可设 `SHOWAI_READER_CDN=off` 禁用 CDN 回退与在线版，或设为逗号分隔的镜像基础地址（支持 `{name}`、`{version}` 占位）。插件安装不会更新独立的软件运行时，也不能预热对话宿主的浏览器缓存；核对实际运行时和生成的交付物，详见[对话展示](../../show-document/references/conversation-display.md)。

不修改系统 HOME，也不直接编辑库里的正式文件。运行期间库位置保持固定；要换库，宿主停止并重连另一个配置，再查 capabilities/context。

## 自定义 Agent / 服务器 runner

宿主也可直接启动已核实运行入口，追加 `mcp --home /ABSOLUTE_LIBRARY`；明确绑定项目时再追加 `--project PROJECT`。可选 `--presentation-directory /HOST_OUTPUT`。配置中的 command/args/env 用参数数组执行，不交给 shell eval。MCP 启动后，Agent 使用工具，不为每次读写拼接 shell 命令。

ShowAI 内置 Agent由宿主提供项目绑定 MCP；它安装的私有 Skill 副本不再同时加载插件的整个内容库启动器。模型 API 与文档 MCP 是两个连接。

## 远程

宿主连接明确的 HTTP MCP 地址，完成所需授权。授权可限定项目，也可覆盖该服务器账号当前及以后有权限的所有项目。`projects_list` 每次读取服务器最新成员权限；账号授权会发现后续同步到服务器的项目。仅保存在本机且尚未同步的项目不在远程列表中。用户明确要求新项目时，且当前工具暴露 `project_create`、账号已授予 `projects.create`，使用该工具创建；保留返回的项目 ID 和 synchronization 回执，后续页面操作显式使用该 ID。重试同一创建请求时复用同一个 operationId；不同请求使用不同 ID。受限授权或工具缺失时说明所缺权限，不绕过到本机创建。项目权限来自服务端当前成员身份。远程没有本机文件配置步骤，不能把用户电脑的 home 当作远程项目路径。远程网关部署与本机内容同步服务是不同模块。

工具未出现在当前会话中，可能需要宿主刷新连接。先核对安装和连接状态；需要重启宿主时协调用户，不自行退出宿主。没有 MCP 连接时说明缺少的入口，不以 CLI 创作或独立文件替代正式项目操作。

GitHub／Google 登录由所选 ShowAI Server 的已配置登录方式提供。已有账号需先绑定对应身份。用户在第三方登录标签页完成验证后，该页显示一个 8 位完成码；用户回到 MCP 授权标签页填入完成码并继续，再确认项目或账号范围授权。完成码由用户本人填写，模型不代为索取或转述。模型不读取、索取或转发密码、登录轮询密钥和会话 Token。服务器未启用对应登录方式时报告实际错误，不把登录按钮可见当作登录已配置。
