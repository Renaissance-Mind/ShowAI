# 在 Cloudflare 部署 ShowAI MCP

**语言：** [English](../cloud-mcp-deployment.md) | 简体中文 · [文档目录](index.zh-CN.md)

MCP 网关与内容服务分别部署。网关使用 Worker、Durable Object、一个 Node Container 和加密 R2 检查点，配置为 deployments/cloudflare/mcp.wrangler.jsonc；内容服务配置为 wrangler.jsonc。

本机 Docker 构建验证镜像，Wrangler 构建/上传生产 AMD64 镜像；本机不承担部署后的服务托管。也可以使用 Cloudflare Workers Builds 从生产 Git 分支构建，参见 [Cloudflare 部署说明](https://developers.cloudflare.com/containers/guides/deploy/)。

## 前置条件

需要目标域名及 Workers/Containers/R2 权限、已认证 Wrangler、Docker daemon 与 Buildx，以及 Node.js 24/仓库依赖或相应构建环境。docker buildx version 应成功；Wrangler 的 --load/--provenance=false 依赖 BuildKit。Homebrew/Colima 可安装 docker-buildx 并配置 CLI 插件目录。

仓库配置 endpoint 为 `https://agent.showai.renaissancemind.ai/mcp`。使用方式见 [ChatGPT 网页接入](chatgpt.zh-CN.md)，实际部署需按本页检查。修改域名时同步修改 SHOWAI_MCP_URL 与 route。用户使用已有 ShowAI Cloud 账号；GitHub/Google 需在内容服务启用，并绑定至目标账号。

构建把 CPU 无关资源放在构建平台生成，仅 npm ci 使用目标 linux/amd64，避免 Vite 仿真。dugite Git 预下载使用锁定包的架构与 SHA-256，带有界重试/临时文件；npm 生命周期脚本保持启用。最终镜像实际执行 Git，并核对完整 Docker COPY 输入与源覆盖。

## 安装 Skill 与连接远程 MCP

安装包含六个 Skill 与远程 MCP 连接的完整 ShowAI 插件。已安装的 use-showai Skill 负责请求分流，其余 Skill 提供对应工作流和参考文件。网关提供工具、授权、存储与渲染；showai_capabilities 返回当前连接的实际能力与限制。

npm run package:plugin 分发共享 Skill，并从源码契约生成操作格式资源；npm run build:cloud-mcp 构建网关与阅读器。更新网关后刷新宿主工具，另行核验安装的 Skill 文件和任务分流。覆盖只读查找、页面创作与续改、对话展示、组件与模板开发、受限项目访问和保留历史的边界。宿主工具发现与 OAuth、项目权限错误分别检查。

## 构建与运行检查

```sh
npm run build:cloud-mcp
npm run check
npm run test:cloud-mcp
npx wrangler@4.148.0 deploy --dry-run --config deployments/cloudflare/mcp.wrangler.jsonc
```

仅 Worker 的 --containers-rollout=none dry-run 不验证镜像。测试中的 Board 图片渲染需要可运行 Chromium。

镜像指定 Debian 实际 /usr/lib/chromium/chromium，避免 /usr/bin 包装器在仿真时错误读取宿主特征。Apple Silicon 仿真 AMD64 仍可能失败，因此部署脚本按 Docker daemon 架构选择原生验证镜像并保留 container-render-check 日志/JSON。

生产仍使用 linux/amd64。网关每次启动先实际截图，再监听；/health 的 browserRendering 必须 passed:true、architecture:x64，并来自本轮部署后启动的生产容器。本机原生检查不能替代生产渲染；失败保持未就绪。

## 从已提交版本部署

在仓库之外选择新的私有发布目录：

```sh
node scripts/prepare-cloud-mcp-release.mjs <handoff-directory> <commit>
node scripts/deploy-cloud-mcp.mjs <handoff-directory>
```

准备脚本导出提交至 release-source 并记录所有 Docker COPY 输入指纹。部署脚本在构建前/发布前核对，按需完成 Wrangler 登录、Docker 与实际截图，保留旧状态密钥，发布并等待新生产容器就绪，检查 HTTPS/OAuth/MCP 发现，写 deployment-result.json。首次密钥备份放 private，必须保留；后续沿用原 secret 与桶。

脚本只在确认默认 Colima 停止、磁盘归属正确且没有活跃 host-agent 后才解锁磁盘，保留 VM 数据。超时或日志年龄不能代替进程核对。部署回执不替代真实 ChatGPT 与第三方登录验收。

首次手工配置可使用：

```sh
npx wrangler@4.148.0 login
npx wrangler@4.148.0 whoami
npx wrangler@4.148.0 r2 bucket create showai-mcp-state
npx wrangler@4.148.0 secret put SHOWAI_MCP_STATE_KEY --config deployments/cloudflare/mcp.wrangler.jsonc
npx wrangler@4.148.0 deploy --config deployments/cloudflare/mcp.wrangler.jsonc
```

先核对现有桶/密钥。状态 key 为 32 随机字节的 64 位小写十六进制，私下输入并保护备份；更新不得重新生成，否则无法解密原授权与恢复状态。

内容服务保留原身份配置。GitHub/Google 回调分别是 /cloud/api/auth/callback/github 与 /google；启用所需 CLIENT_ID/SECRET 后，再对用户提供该登录选项。遵循现有账号绑定与受控注册。

## 分享入口前验证

1. 最终 HTTPS 的 health、OAuth 发现、DCR 与 MCP 工具。
2. 真实 ChatGPT GitHub/Google 登录和正确账号。
3. 账号范围权限、projects.create、实时成员角色。
4. 使用固定 operationId 创建项目、同请求重试、创建/读取/续改页面并核对同步。
5. 别的本地库同步新项目后，原 grant 能发现它。
6. 查看者拒绝写、无关账号拒绝访问、移出/撤销立即生效。
7. Container 重启/休眠后授权、恢复数据与未过期预览保留；错 key/不可用状态拒绝成功。
8. ChatGPT 实际阅读器和下载可用，记录部署镜像/Worker 身份。

## 运行边界

初始服务在单 Container 串行请求，未宣称负载扩展能力。私有状态加密分块保存，未引用块保留，当前没有垃圾回收；不要按年龄删除活跃状态对象。

状态密钥、桶与配置需一起保留。非空恢复目录、缺块、解密或检查点失败应按实际原因恢复，不能清空状态绕过。上游会话照常过期，账号范围授权不延长会话寿命。
