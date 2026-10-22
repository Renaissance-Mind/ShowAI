# 跨宿主 Agent 接入

**语言：** [English](../agent-integration.md) | 简体中文 · [文档目录](index.zh-CN.md)

所有宿主的 Agent 文档操作统一使用 MCP。首先调用 guide() 读取共享入口，再检查 showai_capabilities 和项目上下文。本机插件提供 stdio launcher，远程连接使用 HTTP；CLI 面向服务配置、脚本与运维。

正式内容先保存到项目再 page_present；明确的独立交付使用 render_document。本机 library 连接每次携带 projectId，只读发现用 projects_list，新正式内容可用 project_resolve 与可信宿主绝对目录定位。绑定项目连接沿用其身份。

## 连接、展示与同步

支持 MCP 不代表支持 HTML 显示。兼容宿主可显示 MCP Apps/inline，纯文本宿主仍可保存项目、返回同步回执与文件链接。公共独立渲染、私有项目读写、实际显示分别核对。

本机运行时见「设置 → 插件」中的「当前登记的运行时」与启动配置，或所选内容库的 agent-runtime.json。下面 showai 代表核实后的命令前缀：

```sh
showai runtime info --json
showai guide integration --json
showai public list --kind component --query chart --json
showai public describe chart --view schema --json
showai render --input presentation.json --out /absolute/output/page.html --json
showai mcp --public
showai mcp --project PROJECT_ID
```

公共渲染输入可含 document 或 templateId，以及 title/componentSources/blockIds。自定义组件使用 manifest/schema/source 与可选 files/assets，节点 kind 为 custom；不认识的 widget 不会变成可执行组件。编译在隔离临时目录完成并清理，回执明确 savedToProject:false、synchronized:false。

library MCP 增加 projects_list/project_resolve/project_create；绑定项目连接也可查询公共资源。--public 仅提供公共查询、指南与渲染。私有项目渲染位置在 local/agent-previews 等非同步区域。项目同步使用 project_sync/project_sync_status；明确项目的同步只处理该项目。

## 远程 MCP 服务

MCP 网关独立于内容同步服务器。它使用已安装运行时的 Node、编译器与阅读器，内容服务器只保存快照和对象。

```sh
showai mcp serve \
  --state /absolute/private/showai-agent-state \
  --host 127.0.0.1 --port 8789 \
  --public-url https://agent.example.com \
  --sync-server https://content.example.com
```

使用稳定 HTTPS 代理，MCP 地址为 /mcp，/health 返回就绪状态。--sync-server 支持逗号分隔的受信任服务器基址及 /cloud 前缀。未配置服务器仍可公共渲染。授权选择一个指定项目，或该账号当前与未来可访问项目；每个服务器账号独立连接。

--state 保存私有 OAuth 数据和每份 grant 的项目副本，仅服务账号可访问。反向代理保留公共 Host；公开提交可用 --widget-domain 声明 UI origin。loopback 开发可用 HTTP，发布需 HTTPS。

### Cloudflare

配置 deployments/cloudflare/mcp.wrangler.jsonc，用 Worker/Durable Object 转发到 Node Container。构建入口 build:cloud-mcp 包含编译器、阅读器与共享 Skill 源。状态以独立 SHOWAI_MCP_STATE_KEY 加密并在请求确认前检查点到私有 R2；新容器恢复核验后服务。预览的一小时有效期跨重启保留。

检查点失败不能返回成功。原状态密钥必须备份并在更新时保留；没有自动回收未引用加密块。构建或 dry-run 不证明生产、登录或 ChatGPT 交互通过，见 [部署指南](cloud-mcp-deployment.zh-CN.md)。

## 工具与授权

公共工具包括 showai_capabilities、guide、public_catalog_list/describe、render_document、presentation_source。presentation_source 分块取回公共渲染输入，不公开私有页面导出。匿名调用不会读取个人内容库。

HTTP 私有工具沿用项目操作名，显式传 projectId 并检查 OAuth。projects_list 每次读取当前成员权限。项目范围 grant 仅允许原项目；账号范围包含后续项目。project_create 还需 projects.create，创建并同步后返回服务器 ID；同一 operationId UUID 用于同一请求重试。

每次私有操作验证 token、授权项目、scope 与实时角色，在副本内串行拉取→操作→推送。历史标记为外部 MCP 客户端。响应给出 synchronization.state/error/remoteHead；副本保存但推送失败会返回失败并保留恢复数据。跨设备冲突保留来源副本，应采用返回的实际页面 ID；同设备旧写入仍需处理冲突。

本机路径导入、整站发布和本地恢复留在本机。远程组件通过 component_save 传源码；导出使用服务分配路径并返回临时下载链接。

OAuth 提供发现、DCR、S256 PKCE、resource 绑定、过期访问 token、轮换刷新、授权与撤销。授权流程登录既有 ShowAI 账号，不自动创建或合并。GitHub/Google 使用配置服务器的身份来源：新标签页完成后，把一次性完成码填回发起授权的标签页，再确认项目/账号权限。密码仅转交明确配置的服务器，不保存在网关；上游会话凭据进入私有状态以执行授权操作。

## ChatGPT 与展示宿主

接入官方服务见 [ChatGPT 网页指南](chatgpt.zh-CN.md)。MCP Apps 资源使用 text/html;profile=mcp-app、_meta.ui.resourceUri 及 ChatGPT 兼容字段。页面从工具结果元数据进入宿主沙盒，自定义组件使用 Shadow DOM 内联运行。

对话预览优先带压缩本地阅读器；超预算后可使用固定版本的在线阅读器，从 ShowAI reader 源、jsDelivr、unpkg 加载。delivery.compact 面向模型写 HTML 的宿主。reader:bundled 与 SHOWAI_READER_CDN=off 禁止在线回退；reader:cdn 明确联网。预览链接一小时到期，应保存到项目或保留源数据。纯文本宿主可以交付完整 HTML/source 和项目回执。

远程插件包可由以下命令生成：

```sh
npm run package:plugin -- --mcp-url https://agent.example.com/mcp --out /absolute/new/showai-plugin
```

生成 showai-cloud，复用相同 Skill 与资源，使用 HTTP/OAuth 替代本机 launcher。普通 ChatGPT 网页连接通过 guide 获取流程，不需要 ZIP。本机安装仍使用 plugin:update；公共提交与组织审核是独立流程。

## 已保存页面的展示约定

`page_present({projectId,pageId,blockIds?})` 捕获一个源版本，返回身份/hash/revision，不修改 Page。HTML/source 始终完整；blockIds 只选择 inline 预览。临时构建失败会清理中间目录。

本机输出使用 SHOWAI_PRESENTATION_DIR 或预览目录；HTTP 返回过期下载链接。匿名 presentation_source 无法读取私有源。本机呈现 synchronization.state:not_checked，不主动同步；HTTP 返回实际同步回执。page_export 的局部导出则连同源 JSON 都是局部内容。

本机 launcher 只探测所选库的注册运行时与 showai-mcp-v1，失败明确报错。内置 AgentHost 提供项目绑定 MCP，并从任务私有插件移除 library launcher。模板阶段与参数接口见 [模板文件夹](template-bundles.zh-CN.md) 和 [组件参数](component-parameters.zh-CN.md)。
