# MCP 连接配置

本文件用于宿主接入、连接错误或切换内容库。普通 Agent 文档操作始终使用已连接的 MCP 工具，不先执行 CLI 文档命令。

## 本机插件

本地插件的 `mcp.json` 启动 `mcp/launch.mjs`。启动器读取宿主指定的 `SHOWAI_HOME`，未指定时使用当前用户的 `~/.showai`，再读取该库的 `agent-runtime.json`。`SHOWAI_RUNTIME_CONFIG` 可显式指定配置文件，但其中 home 必须与选定库一致；出错时不搜索其他库。

启动器只用 CLI 做 runtime info 能力探测和启动 MCP。运行时必须声明 `capabilities.agentOperations.protocol=showai-mcp-v1`。缺少时需要更新并登记目标 ShowAI 软件；更新 Skill 不会更新软件。插件本身不包含文档编译运行时。本机需要 Node.js 22.12+ 和已登记的 ShowAI 软件。

可由宿主设置：

| 配置 | 作用 |
| --- | --- |
| SHOWAI_HOME | 明确的本机内容库 |
| SHOWAI_RUNTIME_CONFIG | 该库对应的运行入口配置 |
| SHOWAI_PROJECT_ID | 可选，锁定一个已存在的项目；省略则由工具显式选择项目 |
| SHOWAI_PRESENTATION_DIR | 可选，宿主允许的绝对展示输出目录；否则由运行时分配预览目录 |

不修改系统 HOME，也不直接编辑库里的正式文件。运行期间库位置保持固定；要换库，宿主停止并重连另一个配置，再查 capabilities/context。

## 自定义 Agent / 服务器 runner

宿主也可直接启动已核实运行入口，追加 `mcp --home /ABSOLUTE_LIBRARY`；明确绑定项目时再追加 `--project PROJECT`。可选 `--presentation-directory /HOST_OUTPUT`。配置中的 command/args/env 用参数数组执行，不交给 shell eval。MCP 启动后，Agent 使用工具，不为每次读写拼接 shell 命令。

ShowAI 内置 Agent由宿主提供项目绑定 MCP；它安装的私有 Skill 副本不再同时加载插件的整个内容库启动器。模型 API 与文档 MCP 是两个连接。

## 远程

宿主连接明确的 HTTP MCP 地址，完成所需授权。项目权限来自服务端当前成员身份。远程没有本机文件配置步骤，不能把用户电脑的 home 当作远程项目路径。远程网关部署与本机内容同步服务是不同模块。

工具未出现在当前会话中，可能需要宿主刷新连接。先核对安装和连接状态；需要重启宿主时协调用户，不自行退出宿主。没有 MCP 连接时说明缺少的入口，不以 CLI 创作或独立文件替代正式项目操作。
