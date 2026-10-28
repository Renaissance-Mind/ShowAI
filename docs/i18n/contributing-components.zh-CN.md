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

数据契约是不依赖任何包的校验函数，出错时给出准确的字段路径，例如 `items[3].depends[0]`。它要在没有 React 和打包器的环境中运行，所以不导入任何模块。`propsSchema` 为 Agent 和 Ajv 描述同一份数据，两者需要保持一致。

G2 图表和外部图示家族各有自己的流程。`g2.json` 中的 G2 条目及其导出由 `node scripts/generate-g2-components.mjs` 根据 `src/components/blocks/g2/` 生成，它们的使用说明条目则手工编写。图示家族使用 `diagrams.json`、`diagram-documentation.json` 和 `src/components/blocks/diagrams/`，见[图示组件](diagram-components.zh-CN.md)。`text`、`table`、`stepper` 等基础组件位于 `primitives.json` 和 `Primitives.tsx`，很少新增。

## 新增内容块

下面的步骤依据 `scene-3d`、`roadmap` 等近期新增组件实际改动的文件整理。`src/components/builtin-registration.test.ts` 检查标有 ✓ 的注册点，失败时列出缺少注册的 kind。

1. **数据契约。** 编写导出校验函数的数据契约模块，并在 `.d.mts` 中声明类型，例如 `scene3d-contract.mjs` 导出 `validateScene3dData(data)`。相关组件可以共用一个模块：`roadmap` 和 `waterfall` 都使用 `plan-contract.mjs` 中的 `validatePlanData(kind, data)`。用字段路径拒绝未知结构，为每个列表和字符串设置上限，并在数据契约旁边测试默认数据、示例和应被拒绝的结构（`scene3d.test.ts`、`plan.test.ts`）。
2. **渲染器。** 编写接收 `BlockProps`（`data`、`onChange`、`readOnly`）的 `<Name>.tsx` 及样式表。所有界面文字放进消息命名空间 `src/i18n/messages/<namespace>.ts`，同时提供 `zh-CN` 和 `en`；`src/i18n/i18n.test.ts` 会拒绝写死的中文和不一致的键。使用宿主编辑器共用的选中、右键和悬停菜单，不另加浮动工具栏。
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
13. **Agent 指引。** 在 `plugins/showai/skills/design-presentation/references/reuse-selection.md` 中说明何时选用该组件，然后运行 `npm run package:plugin`，重新生成 Codex、Claude Code 和 Kimi 的 Skill 副本。

## 修改已有内置组件

查找已有内置组件的代码时，从它在 `registry.ts` 中的 `registerBlock` 调用开始，那里写明了渲染器和校验函数。已保存的页面保留写入时的数据，已导出的页面保留导出时的阅读器。因此修改必须接受旧数据契约接受过的所有结构，或者在读取时转换旧数据；不要以会让现有页面校验失败的方式收紧数据契约。数据契约、默认数据或行为变化时，提高 `components.json` 中的 `version`，同时更新 `propsSchema`、示例和使用说明，并在数据契约测试中加入旧结构。

Agent 通过使用说明和示例了解组件，而不是读源码。行为变化后，核对 `usage`、`recipes` 和示例是否仍然准确；选用组件的判断有变化时，同步更新 `reuse-selection.md`。

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
