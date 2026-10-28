# 贡献内置模板

**语言：** [English](../contributing-templates.md) | 简体中文 · [文档](index.zh-CN.md) · [参与开发](CONTRIBUTING.zh-CN.md)

内置模板随每个 ShowAI 运行时一起发布，教 Agent 如何呈现某一类内容，例如一篇研究论文。运行时始终提供 `system-presentation` 系统呈现规则，它描述四个阶段（理解意图、收集材料、呈现逻辑、呈现设计稿）和视觉原则；任务模板在此基础上补充该类内容的方法。本文说明如何新增内置模板、修订内置模板，以及修订系统呈现规则。

## 内置模板还是项目模板

大多数模板应保存在用户的内容库中。装有 ShowAI 插件的 Agent 通过 `create-template` Skill 和 `template_save` 编写模板，模板可以按版本保存、共享和发布，不需要修改本仓库。当这类内容在许多用户中都常见、方法已经在多个真实实例上试过、并且指南在作者不在场时也能被正确使用时，再提议做成内置模板。请先提交功能请求，说明内容类型、服务的读者，以及试用过的实例。

## 模板的写法

模板教的是判断。它的指南说明要弄清读者的哪些情况、要收集哪些材料以及如何核实、如何从内容本身推出讲解顺序，以及哪些设计在哪些情况下有效。它不规定固定大纲、固定组件组合或章节名称，因为每个实例都需要自己的结构。示例要标明只是某一个实例的示例。`paper-explainer` 模板和 `plugins/showai/skills/create-template/references/` 中 `create-template` Skill 的参考文档展示了这种写法。

## 文件夹格式

内置模板是一个文件夹 `resources/templates/<id>/`。完整格式和限制见[模板文件夹](template-bundles.zh-CN.md)，最重要的部分如下：

- `README.md` 以 `---` 包围的严格 JSON frontmatter 开头：`format`（`"showai-template"`）、`schemaVersion`（`3`）、`id`（与文件夹同名）、`name`、`version`（semver）、`description`、`scenarios` 和 `guides`。不接受其他键。frontmatter 之后的正文不超过 4 KiB。
- `guides` 把 `intent`、`material`、`logic`、`design` 四个阶段分别映射到 `guides/` 下的文件或文件夹，或设为 `null` 以沿用系统规则在该阶段的指南。文件夹形式的指南包含 `README.md`，可以再有其他文件。每个阶段的主文件不超过 32 KiB。
- `components` 必须为空。内置模板不能自带组件，设计指南改为指明可用的内置组件。

README 的 frontmatter 已列入 `.prettierignore`，因为 Prettier 会给 JSON 加上尾随逗号。

## 新增模板

1. **文件夹。** 创建 `resources/templates/<id>/`，写好 README 和各阶段指南。与现有模板一样使用中文名称；Agent 读取的就是这些名称和描述。
2. **注册打包。** 在 `src/core/builtin-template-bundles.ts` 中为每个文件加一个 `?raw` 导入，并加入一个打包条目。没有导入的文件不会随运行时发布。README 格式错误时目录加载会抛出异常，在修正之前大多数测试都会失败。
3. **.gitignore。** Markdown 默认被忽略。为每个文件加一行准确的 `!/resources/templates/<id>/…`；缺少时 Git 会让文件保持未跟踪，拉取请求中就没有这个模板。
4. **Studio 导航。** 在 `src/studio/TemplateNavigation.tsx` 的 `types` 中加入模板，并在 `src/i18n/messages/templates.ts` 中加入两种语言的 `type.<id>` 标签。
5. **Agent 指南。** `src/agent/guides.ts` 的 `templates` 主题列出了随附的模板，在那里写上新模板。
6. **测试。** 更新 `src/core/template-workflow.test.ts`（`builtin catalog ships only …`）中预期的模板列表和版本；如果改变了模板的应用方式，再加一个应用该模板的测试。

`src/core/builtin-template-files.test.ts` 检查第 2 到第 4 步，失败时列出缺少的文件或标签。

## 修订模板

内置模板只发布当前文件，用模板创建的页面保留自己的内容。任何文件变化时都要提高 README 中的 `version`，并更新测试中断言的版本。`paper-explainer` 的版本出现在 `src/core/template-workflow.test.ts`、`src/agent/template-workflow.integration.test.ts` 和 `src/agent/mcp-http.integration.test.ts`；在 `src` 中搜索旧版本号可以找到其他位置。

指南中引用的工具调用必须与当前工具 schema 一致。`src/agent/doc-examples.test.ts` 会用工具 schema 检查 `resources/templates/**/*.md` 中的示例。

## 修订系统呈现规则

`system-presentation` 适用于所有呈现任务。`npm run package:plugin` 会把它的 README 正文复制到 `show-document` Skill 的 `showai-system-baseline` 标记之间，并重新生成各宿主插件副本，所以修改该 README 后要运行这个命令并提交生成的文件。系统规则的改动影响所有模板，请在拉取请求中说明你对照新规则重读了哪些现有模板。

## 验证

```sh
npx vitest run src/core/builtin-template-files.test.ts src/core/template-workflow.test.ts
npm run check
npm run build
npm test
```

然后按 Agent 的方式使用模板。启动一个使用独立端口和内容库的开发实例（见[开发与测试](development.zh-CN.md)），从 `npm run dev:status` 返回的 `cli` 字段读取该实例的 CLI 命令和环境，再运行：

```sh
<cli> template context --project PROJECT --templates <id> --json
<cli> template guide design --project PROJECT --templates <id> --json
```

内置模板编译进运行时，因此实例需要在改动后完成重建；MCP 会话保持启动时的代码，所以要在新会话中测试。最后，让连接到该实例的 Agent 根据真实请求用模板制作一个页面，对照指南阅读结果。在拉取请求中写明试用了哪些实例，以及阅读结果后做了哪些修改。
