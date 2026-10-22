# MCP 连接配置

本文件用于宿主接入、连接错误或切换内容库。普通 Agent 文档操作始终使用已连接的 MCP 工具，不先执行 CLI 文档命令。

工具未出现在当前会话中，可能需要宿主刷新连接。先核对安装和连接状态；需要重启宿主时协调用户，不自行退出宿主。没有 MCP 连接时说明缺少的入口，不以 CLI 创作或独立文件替代正式项目操作。

## 本机插件

本地插件的 `mcp.json` 启动 `mcp/launch.mjs`。启动器读取宿主指定的 `SHOWAI_HOME`，未指定时使用当前用户的 `~/.showai`，再读取该库的 `agent-runtime.json`。`SHOWAI_RUNTIME_CONFIG` 可显式指定配置文件，但其中 home 必须与选定库一致；出错时不搜索其他库。

启动器只用 CLI 做 runtime info 能力探测和启动 MCP。运行时必须声明 `capabilities.agentOperations.protocol=showai-mcp-v1`。缺少时需要更新并登记目标 ShowAI 软件；更新 Skill 不会更新软件。插件本身不包含文档编译运行时。

桌面 App 可在「设置 → 插件」给 Codex 或 Claude Code 安装插件。先安装目标宿主及其可用的插件管理 CLI；macOS 也会检测常见 Codex App 位置的内置 CLI。App 复制自带插件，以 App 可执行文件启动 launcher，无需 ShowAI 源码或单独安装 Node.js。安装器检查文件与启用状态，但宿主能力刷新和会话加载仍需分别确认。已有其他来源的 ShowAI 插件时，先在宿主中停用原插件，再安装 App 版本。此入口生成的连接绑定安装时的内容库。继续旧项目时，先确认项目实际所在的库；只有需要重新绑定目标库或移动了 App，才在 App 选定目标库后「更新并启用」，再刷新或重启宿主。外部宿主连接时启动 stdio MCP，App 窗口关闭后仍可使用，App 文件必须保留。

源码方式的插件 launcher 使用系统 Node.js，需要 Node.js 22.12+ 和已登记的 ShowAI 软件。

可由宿主设置：

| 配置                    | 作用                                                       |
| ----------------------- | ---------------------------------------------------------- |
| SHOWAI_HOME             | 明确的本机内容库                                           |
| SHOWAI_RUNTIME_CONFIG   | 该库对应的运行入口配置                                     |
| SHOWAI_PROJECT_ID       | 可选，锁定一个已存在的项目；省略则由工具显式选择项目       |
| SHOWAI_PRESENTATION_DIR | 可选，宿主允许的绝对展示输出目录；否则由运行时分配预览目录 |

项目绑定连接还可设置 `SHOWAI_TEMPLATES`（格式 `ID[@VERSION],ID`）作为该会话的默认模板选择，必须同时设置 `SHOWAI_PROJECT_ID`；内容库连接在每次任务用 template_context 显式选择模板。

对话预览默认携带压缩的本地阅读器；超出聊天预算时，才回退到已发布的 CDN 阅读器。紧凑片段、在线页和显式 `reader:"cdn"` 导出依次从 ShowAI 阅读器源（reader.showai.renaissancemind.ai）、jsDelivr、unpkg 加载阅读器。宿主可设 `SHOWAI_READER_CDN=off` 禁用 CDN 回退与在线版，或设为逗号分隔的镜像基础地址（支持 `{name}`、`{version}` 占位）。插件安装不会更新独立的软件运行时，也不能预热对话宿主的浏览器缓存；核对实际运行时和生成的交付物，详见[宿主显示](host-display.md)。

不修改系统 HOME，也不直接编辑库里的正式文件。运行期间库位置保持固定；要换库，宿主停止并重连另一个配置，再查 capabilities/context。

## 自定义 Agent / 服务器 runner

宿主也可直接启动已核实运行入口，追加 `mcp --home /ABSOLUTE_LIBRARY`；明确绑定项目时再追加 `--project PROJECT`。可选 `--presentation-directory /HOST_OUTPUT`。配置中的 command/args/env 用参数数组执行，不交给 shell eval。MCP 启动后，Agent 使用工具，不为每次读写拼接 shell 命令。

ShowAI 内置 Agent由宿主提供项目绑定 MCP；它安装的私有 Skill 副本不再同时加载插件的整个内容库启动器。模型 API 与文档 MCP 是两个连接。

## 远程

宿主连接明确的 HTTP MCP 地址，完成所需授权。授权可限定项目，也可覆盖该服务器账号当前及以后有权限的所有项目。`projects_list` 每次读取服务器最新成员权限；账号授权会发现后续同步到服务器的项目。仅保存在本机且尚未同步的项目不在远程列表中：请用户在 ShowAI 应用的“设置 → 服务器与同步”把项目同步到同一服务器账号，再重新调用 `projects_list`；仅授权单个项目的连接需重新授权为账号范围才能看到新项目。用户明确要求新项目时，且当前工具暴露 `project_create`、账号已授予 `projects.create`，使用该工具创建；保留返回的项目 ID 和 synchronization 回执，后续页面操作显式使用该 ID。创建超时或结果不明时，用同一个 operationId 和同一名称重试：已创建则返回原项目，不会重复创建；同一 operationId 换名称会被拒绝。不同请求使用不同 ID。受限授权或工具缺失时说明所缺权限，不绕过到本机创建。项目权限来自服务端当前成员身份。远程没有本机文件配置步骤，不能把用户电脑的 home 当作远程项目路径。远程网关部署与本机内容同步服务是不同模块。

GitHub／Google 登录由所选 ShowAI Server 的已配置登录方式提供。已有账号需先绑定对应身份。用户在第三方登录标签页完成验证后，该页显示一个 8 位完成码；用户回到 MCP 授权标签页填入完成码并继续，再确认项目或账号范围授权。完成码一次性、短期有效，由用户本人填写；模型不索取或转述。用户把完成码贴到对话中时不使用它，提醒其在授权页填写。模型不读取、索取或转发密码、登录轮询密钥和会话 Token。服务器未启用对应登录方式时报告实际错误，不把登录按钮可见当作登录已配置。

## 内容组织接口

先读 `showai_capabilities.management` 和当前工具参数。项目操作都显式传 `projectId`。只读查找不创建项目或文件夹；用户要求整理内容时才执行对应写操作。项目、文件夹、正式 Page 和侧栏分组是不同对象，分别使用各自接口。

| 目标                             | 接口与关键参数                                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 找项目与已归档项目               | `projects_list({includeArchived:true})`；默认不含已归档项目                                                                                                                                                                    |
| 项目名称、图标、置顶、归档与恢复 | `organization_update({projectId,action:"update_project",name?,icon?,pinned?,archived?})`；`archived:false` 恢复，归档保留内容。远程归档/恢复需要当前 admin 权限                                                                |
| 读取真实目录                     | `organization_read({projectId,action:"folders",includeArchived?})` 返回文件夹 ID、parentId、图标、置顶与排序偏好；`pages_list({projectId,includeArchived:false})` 取活动页面，省略 includeArchived 保留包含归档页的兼容行为    |
| 创建文件夹                       | `organization_update({projectId,action:"create_folder",name,icon?,parentId?})`；parentId 省略或 null 表示项目根目录                                                                                                            |
| 更新文件夹                       | `organization_update({projectId,action:"update_folder",folderId,name?,icon?,pinned?,archived?})`；归档隐藏后代，恢复保留原层级                                                                                                 |
| 在文件夹中创建 Page/Board        | `page_create({projectId,parentId:文件夹ID,title,kind?})`；内容树中的 Page/Board 容器不充当目录                                                                                                                                 |
| 移动或排序条目                   | `organization_update({projectId,action:"move",kind:"page"或"folder",id,destinationProjectId?,parentId,relativeId?,placement?:"before"或"after",reorderOnly?,baseHash?,baseRevision?})`；parentId 是目标文件夹，null 表示根目录 |
| 设置目录排序                     | `organization_update({projectId,action:"sort",parentId,sortBy:"name"或"createdAt"或"updatedAt"或"manual"})`；只影响该目录直接子项                                                                                              |
| 读侧栏组织                       | `organization_read({projectId,action:"sidebar"})`；项目绑定连接不提供侧栏动作                                                                                                                                                  |
| 创建、改名或移除侧栏分组         | `organization_update({projectId,action:"create_group",name})`；`organization_update({projectId,action:"update_group",sidebarGroupId,name})`，name:null 移除分组并保留项目                                                      |
| 项目分组和手动顺序               | `organization_update({projectId,action:"move_project",sectionId,relativeProjectId?,placement?})`；sectionId 是 projects、pinned 或真实侧栏分组 ID                                                                              |

同项目内的页面改名、图标、收藏、归档、恢复和 parentId 修改，仍可使用 `page_apply` 的 `page.set`。字段里的 parentId 是目录 ID；块操作里的 parentId 是内容容器 ID。页面移动前读取完整当前源并传 baseHash/baseRevision；reorderOnly 只改同层顺序时无需页面内容版本。文件夹只支持项目内移动，不能移入自身或后代。新建或改动目录不会自动重组正文。

跨项目页面移动使用 `organization_update` 的 move，完整保留页面身份，并迁移其精确组件依赖。库连接允许本库项目之间移动；项目绑定连接只允许本项目。远程先从 `projects_list` 取得来源与目标 ID，两个项目都必须在当前授权内且可编辑；调用后检查 `synchronizations` 中的每个项目。远程依次同步目标与来源，中断时保留同步顺序并先恢复待办，不宣称跨两个项目具有服务器事务原子性。结果含错误或未同步状态时说明现状，不能创建另一份 Page 冒充移动成功。

文件夹、项目属性、目录排序和 Page 属于可同步的项目内容。侧栏分组、项目分组关系及库级手动顺序属于当前工作区偏好：本机保存在该库，远程保存在该授权连接的持久工作区，不会随项目同步到其他设备。远程回执的 `workspace.sidebarOrganizationSynchronized:false` 明确这一范围；项目自身的 pinned 属性仍会同步。不要把连接偏好描述为跨设备账号配置。

## 草稿接口

`draft_read({projectId,action:"list",clientId?,resourceId?,kind?})` 只读当前项目的保留草稿，kind 是 page、component 或 template。用返回的 id 调用 `draft_read({projectId,action:"read",draftId})`，读取内容、baseRevision、当前 generation 与作者信息。草稿独立于已保存 Page，也独立于外部文件冲突快照；恢复时先核对原稿、当前正式内容与用户意图。

`draft_write({projectId,action:"save",kind,clientId,resourceId,content,baseRevision?,baseContent?,title?,sequence?})` 保留未提交内容。clientId 是当前编辑客户端的稳定标识；同一客户端使用递增 sequence，同一 sequence 的不同内容会冲突。page 草稿的 baseContent 是准确的源 Page 基线，不使用截取片段或重新猜测的数据。保存草稿不等于保存正式内容。

明确放弃已阅读草稿时调用 `draft_remove({projectId,draftId,generation})`；只处理读取到的代次，发现新代次时报告冲突并保留。丢弃内容仍由本地恢复机制保留。page 草稿先通过正常 page_save/page_apply/合并路径保存，再用 `draft_write({projectId,action:"complete",draftId,generation,revision})` 完成；revision 来自实际保存结果，正式内容必须与该代草稿一致。组件和模板使用各自保存流程，成功后按用户意图移除已处理草稿。

草稿不会随项目同步。本机接口只访问当前库中的项目草稿；远程接口只访问该授权连接持久工作区的项目草稿，不能读取另一设备尚未上传的编辑草稿。远程回执的 `workspace.draftsSynchronized:false` 表示这一点。草稿接口不可访问其他项目或全局未归属草稿。

## 远程参数边界

远程 `page_export` 只声明 html、inline；整站 site 导出需要支持它的本机连接和用户指定的导出任务。远程 page_create/page_save 不接受 components 或 remoteComponents，先 `component_save` 编译可编辑源，再在页面中引用返回的精确版本和 integrity。本机仍可按实际参数传已编译组件或导入外部发布依赖。工具列表、参数和 `management` 能力以当前连接为准；插件更新不会自动更新正在运行的本机服务或远程部署。
