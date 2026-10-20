# 模板文件夹与分阶段呈现

**语言：** [English](../template-bundles.md) | 简体中文 · [文档目录](index.zh-CN.md)

模板打包某一类内容的可复用呈现方法与可选组件库。运行时提供必需的系统呈现基线，所选模板增加当前阶段的指南。本机 Codex/Claude Code 与授权 HTTP MCP 共用此约定。

## 四个阶段

每个呈现任务依次经过四个阶段，每个阶段形成一份记录供下一阶段使用；制作按最终记录落实到 Page，评审对照记录检查已保存的 Page。

| 阶段       | 回答的问题                                       | 记录                                   |
| ---------- | ------------------------------------------------ | -------------------------------------- |
| `intent`   | 读者实际想知道什么，已经理解什么，缺少或误解什么 | 读者简报                               |
| `material` | 需要哪些原始信息，从哪里来，怎样核对             | 材料底稿（通用场景可省略）             |
| `logic`    | 讲什么、按什么顺序讲、讲到多深                   | 多级呈现规划                           |
| `design`   | 环境、整体布局、每个部分的视觉表达与交互         | 逐幕设计稿，详细程度接近图像生成的提示 |

系统基线（`system-presentation`）说明每个阶段与视觉原则：整体与局部都要设计，优先视觉表达，文字承担必要的辅助解释，文字排布保证可读。模板为其内容类型补充领域方法，例如论文讲解怎样带条件地采集数字、哪些画面设计已被验证有效。

## 目录与元信息

```text
my-template/
  README.md
  guides/
    01-intent.md
    02-material.md
    03-logic.md
    04-design/README.md
    04-design/scenes.md
  components/sequence/        # 可为空
    manifest.json
    props.schema.json
    index.tsx
```

README 以两条 --- 之间的严格 JSON frontmatter 开始，再写简短正文。拒绝仅 YAML 语法与未知字段；显式保存参数必须与元信息一致。

```json
{
  "format": "showai-template",
  "schemaVersion": 3,
  "id": "my-template",
  "name": "我的模板",
  "version": "1.0.0",
  "description": "用可见对象和反馈讲解机制。",
  "scenarios": ["阅读机制与证据。"],
  "guides": {
    "intent": "guides/01-intent.md",
    "material": null,
    "logic": "guides/03-logic.md",
    "design": "guides/04-design"
  },
  "components": []
}
```

四个阶段都要声明。阶段值可以是 Markdown 文件、有主 README 的文件夹，或 null（继承系统阶段）。README 正文上限 4 KiB，单指南 32 KiB。组件列表可空。应用模板总是创建空白 Page：本次实例的呈现逻辑与设计稿决定页面结构，而不是保存的骨架。

旧的 schemaVersion 1、2 模板声明六个阶段（intent、evidence、understanding、design、authoring、review）并可带 page.json 骨架。它们继续可读：evidence 与 understanding 指南作为 material 与 logic 返回，authoring 与 review 不再披露，template_context 以 legacyStages 标记。新模板使用 schemaVersion 3。

系统基线始终进入任务上下文，并从同一源嵌入 show-document。项目模板不能替代 system-presentation。无本机 Skill 的宿主可用 `guide({topic:"presentation"})` 读取。阶段文件按需查询，不逐个安装为 Skill。旧 document/composition/contentGuide 模板继续可读。

## 内置模板

| ID                    | 用途                                                                  |
| --------------------- | --------------------------------------------------------------------- |
| `system-presentation` | 必需基线：四个阶段与视觉原则                                          |
| `paper-explainer`     | 论文的可交互讲解：从背景与动机起层层递进，问题 → 机制 → 实验口径 → 证据 → 可信度 → 自测 |
| `blank`               | 仅供 Studio"新建页面"内部使用，不出现在 Agent 目录                    |

`paper-explainer` 从两篇已验证的讲解页（VideoJev、Terminal-RSI）提炼。它的设计指南按读者任务命名组件能力；项目或全局的模板副本附带对应组件库时，template_context 返回精确引用，否则指南列出内置替代。

## 组件库

声明为 `{id:"sequence",path:"components/sequence"}`，manifest 使用此本地 ID 与现有组件契约。包内文本与 base64 图片/字体随包保存。内部依赖声明本地 ID 和精确版本，注册时解析指纹；外部依赖保留精确引用。

保存/导入会真实编译并分配隔离 ID，不同模板可以使用相同本地 ID。组件代码变化需提升组件版本，指南/结构变化提升模板版本。上下文返回实际组件身份，不猜测生成 ID，也不在读取时重复注册。

导入拒绝符号链接、越界路径、不安全名称与大小写冲突；文件夹和网络输入使用相同校验。上限 200 文件、30 组件、16 MiB。上下文与组合阶段响应各有 64 KiB 预算，超限要拆分或单独查询，不静默截断。

## MCP 工作流

1. 检查 templateWorkflow.protocol 为 showai-template-workflow-v2，并确定真实授权项目。
2. 读取系统基线，或复用本会话已加载的相同基线。
3. `template_context({projectId,templates:[{id,scope,version?,integrity?}]})` 返回 README、固定引用、阶段列表和分页组件目录。knownSystemHash/knownHash 仅用于实际持有的文本，按 componentPage.next 继续。
4. `template_guide({projectId,stage,templates:context.templates})` 返回系统阶段与精确模板指南，每次一个阶段。文件夹阶段按所列文件，用 templateId/file 读取子文件。
5. 形成各阶段记录：读者简报、材料底稿、呈现规划、设计稿。复杂作品把规划与设计稿保存为 `presentation-plan.json`（nodes 与 scenes），并用 plan-presentation 的脚本检查。
6. template_apply 应用模板（绑定精确引用的空白 Page），或遵循用户的空白页选择；按设计稿制作页面。
7. 保留当前 hash/revision 保存，再展示。page_read 的 response:source 返回完整源，receipt 返回身份/写入回执，默认 full 保持兼容。

Page.templateContext 保留 format/system/templates 精确引用供续改，不保存 context 响应 hash。可用 page.set 明确修改。引用不授予跨项目权限；缺失旧版本需报告或导入，不能猜用最新版。

每次任务或连接的模板选择独立，不修改全局当前模板。省略 templates 使用启动默认；显式 [] 清除本次选择但保留系统指南。knownHash 不绕过授权/身份检查。

网络保存使用 `template_save({projectId,input:{bundle:{format:1,files,assets?}}})`：files 映射相对路径到 UTF-8，assets 映射资源路径到 base64。网页不能传服务器本地目录。

匿名客户端可查内置文件夹模板和系统基线，public_catalog_describe 可指定 stage/version/integrity；render_document 可通过 templateId/templateVersion/templateIntegrity 实例化。项目模板与注册需要授权。

## 本机管理与宿主

```sh
showai template import ./my-template --project PROJECT --json
showai template export my-template --project PROJECT --out ./new-folder --json
showai template context --project PROJECT --templates my-template@1.0.0 --json
showai template guide design --project PROJECT --templates my-template --json
showai mcp --project PROJECT --templates my-template@1.0.0
```

启动 --templates 需要 --project；library/HTTP 用工具选择。插件支持 SHOWAI_TEMPLATES 与 SHOWAI_PROJECT_ID。CLI 管理本机目录，Agent 文档操作使用 MCP。

Codex 包使用 plugin.json/mcp.json，Claude Code 使用 .claude-plugin/plugin.json/.mcp.json。远程包改用 HTTPS；ChatGPT 直接从 endpoint 读取共享指南并按 OAuth 权限操作，无需本机插件。更新 Skill 不自动更新已运行软件/MCP；launcher 会检查协议并报告不兼容。
