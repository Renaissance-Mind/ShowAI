# 界面场景与交互检查

[English](../ui-lab.md)

UI Lab 打开真实的 `src/main.tsx → App → Studio` 应用，用编号标注当前功能参与测试的控件。独立面板提供界面状态切换和可折叠流程树。状态准备、截图与自动检查复用同一份应用操作。

## 启动 Demo

使用 Node 24 或更新版本及仓库依赖。先构建一次，提供应用运行资源；缺少 Chromium 时安装与 `playwright-core` 匹配的版本。

```sh
npm run build
npx playwright-core install chromium
npm run ui:lab -- --port 5859 --state /absolute/path/ui-lab/state --out /absolute/path/ui-lab/results
```

打开命令返回的 `/__ui-lab/` 地址。启动命令本身不打开窗口。在顶部选择测试功能，编号标出该功能可测试的控件。点击编号或右侧对应操作，会调用真实控件。状态按钮切换连接中、失败、等待审批、成功等条件；流程树可展开分支并直接跳到指定状态，进入后继续操作实际应用。

跳转会新建隔离会话，通过真实前置操作准备所选状态，准备期间隐藏中间过程。自由输入的数据属于当前会话。正常点击应用后，面板会跟随实际界面更新。主题、视口、标注可见性可以独立调整。“界面检查”用测试定义的可重复数据验证并截取该状态，结果在独立面板中查看。

远程连接场景包括多入口同时开启与独立关闭，也覆盖局域网访问密钥、Tailscale 私网、Cloudflare 临时隧道、Cloudflare 固定域名、Tailscale Funnel、ChatGPT 接入、项目权限、失败恢复和拒绝授权。工作台场景还会通过真实界面创建项目，并用真实后端核对文件结果。

模拟范围明确放在服务边界：远程 MCP 响应、隧道启动、OAuth 请求和客户端调用使用模拟服务。界面组件、应用样式、设置导航、表单、状态转换及工作台存储使用产品源码。这些场景不能证明真实 Tailscale 或 Cloudflare 路由可达，也不能证明 ChatGPT 已完成外部登录。协议和网络集成检查单独运行，包括 `src/remote-mcp/` 下的测试。

浏览器后端提供远程设置所需的桌面渲染器能力。场景中禁用宿主安装、外部 Agent 扫描、打开系统目录及新应用窗口。复制操作只记录结果，不修改系统剪贴板；插件导出返回模拟结果。隐藏 Electron 在原生窗口中检查这份渲染器，桌面 IPC 和操作系统集成仍有各自的验收测试。

在「测试功能」中选择**工作台动效**，或直接打开 `/__ui-lab/?feature=workbench-motion`。右侧的状态按钮可进入目录箭头、标签切换、导航侧栏和 Agent 面板。多选栏和顶栏搜索各有「当前」和「候选」两个场景，使用相同的示例数据和真实控件。候选样式仅在对应的 Lab 场景生效。查看导航侧栏收起效果时，先解除固定，再把指针移入正文。

点击**界面检查**会在标准动效和减少动态效果两种偏好下执行该场景，先记录操作期间触发的 CSS 动画和过渡事件，再截取终态。导航侧栏和 Agent 面板还会统计正文宽度的变化次数。各步观测值显示在检查结果中。

## 截图与验证

```sh
npm run test:ui -- --flow --feature remote-connection --out /absolute/path/ui-lab/results
npm run test:ui -- --flow --feature remote-connection --node lan.error --node funnel.chatgpt.verify --out /absolute/path/ui-lab/results
npm run test:ui -- --url http://127.0.0.1:5859 --feature remote-connection --scene chatgpt --scene permissions --theme dark --width 800 --height 1000 --scale 2 --out /absolute/path/ui-lab/results
npm run test:ui -- --url http://127.0.0.1:5859 --feature workbench --out /absolute/path/ui-lab/results
npm run test:ui -- --flow --feature workbench-motion --out /absolute/path/ui-lab/results
npm run test:ui -- --renderer electron --feature remote-connection --scene lan --out /absolute/path/ui-lab/results
```

没有 `--url` 时，测试命令会启动独立服务并在结束后关闭。提供 `--url` 时复用 Demo 服务，运行结束后继续保留。使用 `--flow` 检查界面状态，重复 `--node` 可选择多个状态；原有 `--scene` 用于工作流回归，省略选择器时运行所选类型的全部项目。`--annotations` 在状态截图中包含控件编号标注。`--locale en` 检查英文界面。支持宽度 760–2560、高度 560–1800 CSS 像素，缩放比例为 1 或 2；默认 1440 × 1000、2 倍像素。1 倍截图按 CSS 像素输出；Retina 原生渲染器的实际设备倍率另外记录在布局测量中。

每轮生成 `report.json`、可离线打开的 `index.html`、视口 PNG、无障碍 DOM 快照、布局测量和脱敏服务调用记录。交互失败会保留现场截图和 DOM。截图前等待断言、字体、可见图片和两帧渲染，截图时禁用 CSS 动画并隐藏光标。检查会拒绝缺失的应用根节点、视口溢出，以及未满足场景要求的弹窗间距和主按钮对比度。渲染器异常使场景失败，控制台错误单独记录供排查。报告记录提交及工作区哈希，执行过程中源码变化会使本轮无效。文件内容不变时，暂存或提交代码不会让本轮失效。

较大的调用参数记录为字节数与 SHA-256 哈希，避免每份报告重复保存完整示例和数据集。

Chromium 使用无头模式。Electron 创建隔离 profile 的隐藏窗口，拒绝新建原生窗口，持续记录显示、聚焦和激活事件；发生任何此类事件都会使检查失败。两种渲染器都不使用系统鼠标或键盘。原生系统对话框及前台窗口行为需要独立显示环境，或另行获得明确授权后验收。

## 审阅画面变化

```sh
npm run test:ui -- --feature remote-connection --baseline /absolute/path/ui-lab/baselines --update-baseline --out /absolute/path/ui-lab/results
npm run test:ui -- --feature remote-connection --baseline /absolute/path/ui-lab/baselines --out /absolute/path/ui-lab/results
```

审阅截图后再使用 `--update-baseline`。普通运行不会覆盖基线。基线按平台、架构、渲染器、语言、主题、视口和像素比例区分。缺失或尺寸变化会使对比失败，像素变化会生成差异 PNG。比较允许 0.1% 的差异像素，单像素阈值为 0.1；重复对比时应固定运行时、字体和环境。未提供基线时，交互与布局断言可以通过，画面仍标记为 `unreviewed`。

通过 `--flow --baseline DIRECTORY` 对界面状态进行视觉比较。控制台的状态检查可在没有基线时截图，首次画面标记为待审阅。报告同时呈现当前截图、基线和差异图。

## 接入其他功能

1. 在 `src/ui-lab/features/` 添加功能模块，登记到 `registry.ts`。
2. 用 `SceneContext.ui` 描述准备和操作，优先使用无障碍角色与准确名称，每步断言操作结果。需要核对后端状态时使用 `inspect()`。
3. 真实工作台操作选择 `none` fixture。需要控制外部依赖时，在 `fixtures/` 添加服务实现，并接入服务端 fixture 工厂。模拟保持在服务边界，输入按应用契约校验。
4. 通过 `event()` 声明确定性的外部事件，在准备不同状态时使用。为状态转换、拒绝路径和资源释放补充单元测试。可见文案放入双语消息模块。
5. 在控制台手动操作后运行 Chromium 检查；涉及渲染器行为时增加隐藏 Electron 检查。审阅截图后再建立视觉基线。

通过 `src/ui-lab/flow.ts` 中的 `uiFlow()` 接入流程定义。每个节点声明 `enter` 准备过程、唯一的界面匹配目标 `matches`、可选的服务条件 `when`，以及指向真实控件的 `actions`。`parent` 组织可折叠分支；`screen` 与 `variants` 组织状态切换；`stateLabel` 和 `variantLabels` 可为状态条件设置不同于树节点的名称。准备过程可复用已有场景的前缀步骤。观察器在交互后根据实际 DOM 与服务状态识别当前节点。共用的目标接口及 DOM/Playwright 两种驱动使交互准备与自动检查保持一致。`capture` 目标可以增加局部细节图，视口截图始终保留完整应用环境。fixture 和控制台只用于开发，正常生产入口会排除 UI Lab 启动代码。

## 运行归属与清理

每个会话独立保存内容库、设置、Agent 状态和工作目录。重置会关闭对应后端并移除临时内容库、profile 和工作目录，保留会话元信息及脱敏调用记录。测试渲染器退出后清理 profile。报告和已审阅基线保存在 `--out` 与 `--baseline`；保留审阅所需轮次，主动清理旧的生成结果。UI Lab 不修改稳定版 App 及其内容库。

手动场景的应用事件连接关闭约 30 秒后也会自动回收。保持连接的应用会继续运行，包括独立打开的应用，避免关闭标签页和前端刷新积累后端进程。

```sh
npm run ui:lab -- status --state /absolute/path/ui-lab/state
npm run ui:lab -- stop --state /absolute/path/ui-lab/state
```

状态命令向监听服务核对保存的进程身份。停止命令请求正常关闭，并等待进程退出及关闭记录完成；服务释放各会话，CLI 清理临时 bundle。修改后端或 fixture 后重启服务；前端修改通过 Vite 开发刷新更新。`server.json` 记录进程与目录，`closed.json` 记录关闭完成。

机制本身使用 `npx vitest run src/ui-lab` 检查。仓库验收仍包括 `npm run check`、`npm run build` 和 `npm test`。
