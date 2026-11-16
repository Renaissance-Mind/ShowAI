# 贡献内置组件

**语言：** [English](../contributing-components.md) | 简体中文 · [文档](index.zh-CN.md) · [参与开发](CONTRIBUTING.zh-CN.md)

内置组件随每个 ShowAI 运行时一起发布：桌面与浏览器工作台、CLI 与 MCP 服务、导出页面中的离线阅读器，以及 CDN 阅读器。Agent 无需安装即可通过 `catalog_list` 找到它，页面只保存它的数据。本文说明如何新增内置组件，以及如何修改已有的内置组件。

## 内置组件还是项目组件

大多数可复用组件应当先做成项目组件。装有 ShowAI 插件的 Agent 通过 `create-component` Skill 创建它们，组件在用户内容库中按版本保存，可以提升为全局组件或发布（见[组件与模板](catalog-lifecycle.zh-CN.md)），不需要修改本仓库。

当组件服务于多类内容而非单一主题、数据契约已经稳定、并且已经作为项目组件或在真实页面中经过检验时，再提议做成内置组件。请先提交功能请求，商定 `kind` 名称、保存的数据，以及它与现有内置组件的关系。扩展已有内置组件往往比新增一个相近的组件更好：`stepper` 取代了 `step-walkthrough`，后者现在只为已有页面保留。

`resources/catalog/task-gantt`、`value-slider` 和 `text-diagram` 中的文件夹是可导入的组件包，用作示例和测试夹具。它们不是内置组件，也不会被自动注册。

## 内置组件的组成

典型的内置组件是一个 React 内容块。它的数据是保存在页面中的 JSON 对象；内容块负责渲染数据，通过 `onChange` 编辑数据，并在阅读视图和导出页面中遵守 `readOnly`。下面四部分描述一个内置组件：

| 部分     | 位置                                                    | 使用方                                                           |
| -------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| 数据契约 | `src/components/blocks/<name>-contract.mjs` 及 `.d.mts` | 工作台、CLI 与 MCP 保存、文档校验和离线阅读器                    |
| 渲染器   | `src/components/blocks/<Name>.tsx` 及 `<name>.css`      | 工作台、阅读器和可编辑的 SDK 副本                                |
| 目录条目 | `resources/catalog/components.json`                     | 注册表默认数据、`catalog_list`、用 Ajv 校验 `propsSchema` 与示例 |
| 使用说明 | `resources/catalog/component-documentation.json`        | `catalog_describe` 的指南与参数视图，Agent 写数据前读取          |

数据契约是不依赖任何包的校验函数，出错时给出准确的字段路径，例如 `items[3].depends[0]`。它要在没有 React 和打包器的环境中运行，内容库和 Agent 服务也会导入它，所以只能导入其他数据契约、`src/contract`、`src/document`、`src/lib` 以及不依赖 DOM 和 React 的包，`src/layering.test.ts` 会检查这一点。`propsSchema` 为 Agent 和 Ajv 描述同一份数据，两者需要保持一致。

G2 图表和外部图示家族各有自己的流程。`g2.json` 中的 G2 条目及其导出由 `node scripts/generate-g2-components.mjs` 根据 `src/components/blocks/g2/` 生成，它们的使用说明条目则手工编写。图示家族使用 `diagrams.json`、`diagram-documentation.json` 和 `src/components/blocks/diagrams/`，见[图示组件](diagram-components.zh-CN.md)。`text`、`table`、`stepper` 等基础组件位于 `primitives.json` 和 `Primitives.tsx`，很少新增。

## 新增内容块

下面的步骤依据 `scene-3d`、`roadmap` 等近期新增组件实际改动的文件整理。`src/components/builtin-registration.test.ts` 检查标有 ✓ 的注册点，失败时列出缺少注册的 kind。

1. **数据契约。** 编写导出校验函数的数据契约模块，并在 `.d.mts` 中声明类型，例如 `scene3d-contract.mjs` 导出 `validateScene3dData(data)`。相关组件可以共用一个模块：`roadmap` 和 `waterfall` 都使用 `plan-contract.mjs` 中的 `validatePlanData(kind, data)`。用字段路径拒绝未知结构，为每个列表和字符串设置上限，并在数据契约旁边测试默认数据、示例和应被拒绝的结构（`scene3d.test.ts`、`plan.test.ts`）。
2. **渲染器。** 编写接收 `BlockProps`（`data`、`onChange`、`readOnly`）的 `<Name>.tsx` 及样式表。所有界面文字放进消息命名空间 `src/i18n/messages/<namespace>.ts`，同时提供 `zh-CN` 和 `en`；`src/i18n/i18n.test.ts` 会拒绝写死的中文和不一致的键。使用宿主编辑器共用的选中、右键和悬停菜单，不另加浮动工具栏。展示类组件（读者查看和探索的图示、图形、图表）的阅读画面里不放编辑表单，不显示节点 `kind`、枚举名这类内部值；详情面板只在有解释内容时打开。这类组件通过修改数据改变，例如 `flowchart`、`mechanism-diagram` 和 `svg`。
3. **目录条目 ✓。** 在 `components.json` 中加入对象，包含 `kind`、`name`、`description`、`scenarios`、`defaultData`、`propsSchema`、`examples`（每项为 `{ name, request, data }`）、`version`（semver，从 `1.0.0` 开始）和 `effects`。目录中的名称和描述保持中文，Agent 和 CLI 读取的就是这些文字。
4. **使用说明 ✓。** 在 `component-documentation.json` 中以 kind 为键加入条目，包含 `version`、`reuse`、`usage` 和 `development`；可以参照 `roadmap` 等近期条目的结构。现有内置组件使用说明版本 1。版本 2 增加经过核验的参数含义和省略规则，见[组件参数](component-parameters.zh-CN.md)。
5. **注册 ✓。** 在 `src/components/blocks/registry.ts` 中加入懒加载导入，以及一个字面量形式的 `registerBlock({ kind: "…", … })`：从 `componentMetadata` 读取 `defaultData`，把数据契约作为 `validate` 传入。kind 必须是字符串字面量，因为 `scripts/build-reader-source.mjs` 会解析这些调用，让导出页面只打包实际用到的组件。
6. **文档校验。** 在 `src/portable/validation.mjs` 中导入数据契约，并在 `validateWidgetData` 中加入 `kind === "…"` 分支。未知 kind 会不经检查直接通过，缺少分支时没有测试能发现，这一步需要人工核对。
7. **可编辑 SDK ✓。** 在 `src/components/blocks/sdk.tsx` 中导出渲染器。在 `src/core/builtin-sources.ts` 中把 `.tsx`、`.css`、数据契约和消息文件以 `?raw` 导入加入 `sources`，并把导出名加入 `builtinExports`。随附文件导入了未随附的模块时，`npm run check:sdk` 和 i18n 测试会失败。
8. **英文显示 ✓。** 在 `src/components/builtin-display-text.ts` 中加入英文 `name` 和 `description`。缺少时英文界面会显示中文目录文字。
9. **分类 ✓。** 在 `src/core/component-categories.ts` 的 `builtinCategories` 中加入 kind，组件浏览器据此分组。
10. **对话内展示就绪度 ✓。** 在 `resources/catalog/inline-readiness.json` 中加入 `{ "status": "ready" }`；组件在对话中展示效果还不好时，使用其他状态并附上 `note`。用下文的就绪度测量获得结果。
11. **写死的列表。** 把 kind 加入 `src/core/catalog.test.ts` 中的有序列表（`describes all built-in blocks for agents`）；需要离线阅读器挂载它时，也加入 `src/agent/presentation-export.test.ts`。
12. **运行时依赖。** 运行时使用的新 npm 依赖要加入 `package.json`、`scripts/package-runtime.mjs` 的复制列表、`src/core/catalog.ts` 中 `compilePackage` 的运行时与 SDK 导入允许列表，许可证文本放进 `resources/licenses/`。新图标从 `src/ui/icons.ts` 导出。
13. **Agent 指引。** 在 `resources/templates/system-presentation/guides/04-design.md` 的“组件与素材”一段中说明何时选用该组件，然后运行 `npm run package:plugin`，把这份指南嵌入 `show-document` Skill，并重新生成 Codex、Claude Code 和 Kimi 的 Skill 副本。另见[修订系统呈现规则](contributing-templates.zh-CN.md#修订系统呈现规则)。

## 组件运行时契约

内置组件元数据与自定义 manifest 共用 contract version 1。src/contract/component-contract.mjs 提供 schema、校验、对象发现和旧版适配。catalog describe ID --view contract 返回声明与能力；--page PAGE --block BLOCK 读取实际实例，--object-offset / --object-limit 分页。Agent 使用同一 catalog_describe 入口；guide component 的 input.runtimeContractSchema 提供准确 schema，showai_capabilities.componentRuntime 提供宿主支持信息。

契约可声明对象集合与稳定身份、带类型的通知和请求事件、局部动作、原生富文本子内容、内容块引用、独立版本的阅读状态及必需宿主能力。路径使用 JSON pointer，* 遍历一层。没有声明的包保留 legacy 适配，可点击界面不自动具有公开事件。

新实现接收 runtime，或从 showai:components 导入 useComponentRuntime、useComponentAction、ComponentContent。事件返回 handled、unhandled、unavailable、failed 回执；数据更新的 handled 表示宿主接受了更新，正式持久化仍以 Page 保存的 hash/revision 为准。runtime.dataState 提供字段权限，阅读状态只属于当前读者。动作在自己的组件实例中注册执行，跨组件行为由父组件显式处理事件。

只有声明的 slot 进入内容遍历、依赖收集和 ID 更新。自定义包通过 accepts 列出要包含的内置 widget；custom 子组件还需 manifest.dependencies 精确引用。普通业务 JSON 即使形似 doc 也不作为子内容处理。引用指向 slot，可用共享路径前缀隔离重复分组；目标缺失或歧义应报错。业务数据关系继续使用已有参数关系规则。文档层通过声明处理引用，不检查组件名称或私有数据形状。

工作台、沙箱与 inline 共用宿主操作校验。inline 子内容复用宿主阅读器，沙箱包包含自己的实现。完整传输超出对话预算时，对话交付可省略未使用的沙箱 HTML，以 presentationOnly 标记执行投影；存储的组件包不变，投影不能作为组件包导入。原回调、页面目录 role 和数据库字段 contributes 均通过兼容适配继续工作。新的特权宿主服务需要平台提供明确的版本化能力。

新增能力时验证真实编译与两种执行模式、实例对象发现、只读与未处理行为、对象删除、带作用域的复制和模板插入、业务 JSON 隔离、导出及旧不可变包。契约、公开类型、指南、SDK 导出和宿主校验应同时更新。

## 组合阅读交互

容器可以使用 `showai:components` 的 `ComponentInteractions` 绑定子组件的阅读动作。目标身份为 `{type, scope, id}`：Flowchart 使用 `type: "node"`、`scope: flow.id`、`id: node.id`；LayerDiagram 使用 `type: "module"`、`scope: layer.id`、`id: module.id`。身份与文字、布局和 DOM 选择器无关。

```jsx
<ComponentInteractions
  targets={[{ type: "node", scope: "system", id: "services" }]}
  onActivate={() => setLevel("services")}
>
  <Flowchart data={overview} readOnly />
</ComponentInteractions>
```

Provider 只处理声明过的目标；没有绑定的对象沿用原来的详情和播放行为。新增目标的组件使用 `useComponentInteractions().canActivate(target)` 判断是否提供动作，点击或键盘激活时调用 `activate(target)`。只有容器处理了动作才返回 true，否则继续原有阅读行为。嵌套 Provider 隔离各自的绑定。阅读事件不调用 `onChange`。

内置 `multi-level-view` 的每层使用原生内容，可组合已有组件；通过组件块 ID 与公开对象事件绑定子层，直接从组件目录插入；`examples/multi-level-view` 保留自定义组合示例。`createMultiLevelView(registry)` 接收组件渲染器和列举稳定目标的适配器，每层保留子组件的原生 props；自定义组件依赖仍需声明精确版本。模型在渲染前检查循环、不可达视图、重复绑定和不存在的目标。

## 修改已有内置组件

查找已有内置组件的代码时，从它在 `registry.ts` 中的 `registerBlock` 调用开始，那里写明了渲染器和校验函数。已保存的页面保留写入时的数据，已导出的页面保留导出时的阅读器。因此修改必须接受旧数据契约接受过的所有结构，或者在读取时转换旧数据；不要以会让现有页面校验失败的方式收紧数据契约。数据契约、默认数据或行为变化时，提高 `components.json` 中的 `version`，同时更新 `propsSchema`、示例和使用说明，并在数据契约测试中加入旧结构。

Agent 通过使用说明和示例了解组件，而不是读源码。行为变化后，核对 `usage`、`recipes` 和示例是否仍然准确；选用组件的判断有变化时，同步更新 `04-design.md` 的“组件与素材”一段。

## 验证

开发过程中运行快速检查，提交拉取请求前运行完整检查。

```sh
npx vitest run src/components/builtin-registration.test.ts src/components/blocks/<contract>.test.ts
npm run check
npm run build
npm test
npm run test:component-gallery
```

`npm test` 会运行目录测试：编译每个内置组件的可编辑源码，用 `propsSchema`、使用说明和数据契约校验默认数据与示例，并在 CDN 阅读器中渲染每份默认数据和示例。用 `npx vitest run` 单独运行某个文件前，需要先运行 `npm run build:portable`；读取 `dist-agent` 或 `dist-runtime` 的测试需要先运行 `npm run build`。

测量对话内展示就绪度时，运行就绪度集成测试，再把结果填入 `inline-readiness.json`：

```sh
SHOWAI_INLINE_READINESS=1 SHOWAI_INLINE_READINESS_OUT=/absolute/report.json \
  npx vitest run src/agent/inline-readiness.integration.test.ts
```

然后在开发实例中检查组件（见[开发与测试](development.zh-CN.md)）：从组件菜单插入、编辑、切换到阅读视图、重新加载，用 `export --format html` 导出页面并离线打开，再检查窄窗口和深色主题。桌面特有的行为需要在桌面实例中验证，浏览器结果不能代替。在拉取请求中写明检查了哪些项目。
