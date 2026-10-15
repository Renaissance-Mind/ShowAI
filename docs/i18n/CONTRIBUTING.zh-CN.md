# 参与 ShowAI 开发

**语言：** [English](../../CONTRIBUTING.md) | 简体中文

本指南说明开发环境、相关验证与 Pull Request。产品与集成说明见[文档目录](index.zh-CN.md)。

## 环境准备

需要 Node.js 22.12+、npm 和 Git。浏览器集成测试需要 Chromium：npx playwright install chromium。测试插件时可安装 Codex CLI 或 Claude Code。

```sh
git clone https://github.com/Renaissance-Mind/ShowAI.git
cd ShowAI
npm ci
```

## 开发实例

完整开发入口支持热更新：前端原地刷新，后端、主进程、preload、内置组件和 CLI 自动重建，确认保存后重启；冲突会暂停重启。

| 命令                              | 用途                                   |
| --------------------------------- | -------------------------------------- |
| npm run dev:open                  | 后台启动或复用桌面开发实例             |
| npm run dev:open -- browser       | 后台启动或复用浏览器工作台             |
| npm run dev:status                | 查看模式、端口、内容库、源码分支与进程 |
| npm run dev:desktop / dev:browser | 前台运行完整工作台                     |
| npm run dev                       | 独立单页画布                           |

默认端口 5173，开发库 .showai-dev/library。并行实例使用各自空闲端口、内容库和桌面配置目录：

```sh
mkdir -p /absolute/showai-dev-a/profile /absolute/showai-dev-a/tmp
SHOWAI_USER_DATA=/absolute/showai-dev-a/profile TMPDIR=/absolute/showai-dev-a/tmp \
  npm run dev:open -- --port 5180 --home /absolute/showai-dev-a/library --no-focus
npm run dev:status -- --port 5180 --home /absolute/showai-dev-a/library
```

--home 使用绝对路径，进程运行期间固定。SHOWAI_USER_DATA 隔离桌面设置与 Agent 状态。dev:open 的 --no-focus 和前台入口的 --no-open 适合后台运行。每实例构建和启动记录保存在 .showai-dev/<mode>-<port>/，运行中不要移动或删除。

会写数据的开发验证使用独立库。右下角开发标记显示源码、分支与启动提交。清理前停止本任务进程，保留源材料和必要证据，不把其他活跃实例当作缓存。

## 验证

代码变更按以下顺序完成基础检查：

```sh
npm run check
npm run build
npm test
```

| 修改范围         | 相关命令                                           |
| ---------------- | -------------------------------------------------- |
| Electron 行为    | npm run test:desktop                               |
| Page/Board 交互  | npm run test:containers 与 test:containers:desktop |
| 开发启动与热更新 | npm run test:dev 与 npm run test:dev -- desktop    |
| 浏览器服务       | npm run test:browser                               |
| 同步服务器       | npm run test:server                                |
| HTTP MCP         | npm run test:cloud-mcp                             |

使用真实文件读写与组件编译。Windows 缺少符号链接权限时跳过相关文件链接项，其余完整性检查继续。浏览器通过不能代替 Electron 行为验证。文档修改检查命令、链接、语言对应和版本说明，按影响范围选择其他测试。

## 插件与文档

修改 plugins/showai 的 Skill、参考说明或 manifest 后执行 npm run plugin:update -- --json。核对成功、enabled、version、installedPath、verifiedFiles 与 treeSha256。安装、宿主刷新与新会话看到工具分别验证。修改 CLI 协议时同步相关说明。

公开文档同步维护：根中英文 README、docs/TOPIC.md 与 i18n/TOPIC.zh-CN.md，以及两个文档目录。保留语言切换和有效相对链接。命令以当前实现为准，区分源码、已安装软件/插件、部署服务与发行包。内部计划、凭据、本机状态、测试日志和验收材料留在公开文档之外。

## 提交与反馈

Pull Request 聚焦一个变更，说明原因、结果及验证范围。使用 Conventional Commits，如 feat(editor)、fix(sync)、docs。功能优先复用已有菜单与动作；在 I/O、进程和输入边界处理错误并显示原因。Markdown 默认忽略，新增公开文档只添加精确 .gitignore 例外。

通过 [GitHub Issues](https://github.com/Renaissance-Mind/ShowAI/issues) 提供平台、版本/提交、桌面或浏览器、复现步骤与预期/实际结果。参与须遵循[行为准则](CODE_OF_CONDUCT.zh-CN.md)，贡献采用 [MIT 许可证](../../LICENSE)。
