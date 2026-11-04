# 模板文件夹与制作流程

**语言：** [English](../template-bundles.md) | 简体中文 · [文档目录](index.zh-CN.md)

模板打包某一类内容的可复用呈现方法与可选组件库。运行时提供必须遵循的制作流程，所选模板补充这类内容的方法，不重复流程。本机 Codex/Claude Code 与授权 HTTP MCP 共用此约定。

## 制作流程

每份作品依次经过七个环节，每个环节回答一个问题，交出一份记录供下一个环节使用。

| 环节     | 回答的问题                                         | 记录                                   |
| -------- | -------------------------------------------------- | -------------------------------------- |
| 理解意图 | 读者实际想知道什么，已经理解什么，缺少或误解什么   | 读者简报                               |
| 收集材料 | 需要哪些事实与数字，来源是什么，在什么条件下成立   | 材料底稿（通用场景可省略）             |
| 呈现逻辑 | 讲什么、按什么顺序讲、讲到多深                     | 多级呈现规划                           |
| 设计稿   | 环境、整体布局、每个部分的视觉表达、文字落点与交互 | 逐幕设计稿，详细程度接近图像生成的提示 |
| 制作     | 每一幕怎样写入 Page                                | 填回设计稿各幕的块 ID                  |
| 评审     | 已保存的 Page 是否支持读者简报与设计稿             | 评审记录                               |
| 交付     | 读者在哪里打开作品，哪些部分还没有验证             | 展示给用户的 Page                      |

内置的 `system-presentation` 模板是这套流程的来源。它的 README 列出各环节与视觉表达原则：整体与局部都要设计，优先用图表达，机制图画出状态，文字补足图，文字排布保证可读；它的指南分别说明每个环节怎样做。任务模板为其内容类型补充方法，例如论文讲解怎样带条件地采集数字、哪些画面设计已被验证有效。

## 目录与元信息

```text
my-template/
  README.md
  guides/                     # 在 README 中列出，按列出顺序阅读
    reader.md
    scenes.md
  components/sequence/        # 可为空
    manifest.json
    props.schema.json
    index.tsx
```

README 以两条 --- 之间的严格 JSON frontmatter 开始，再写简短正文。拒绝仅 YAML 语法与未知字段；显式保存参数必须与元信息一致。

```json
{
  "format": "showai-template",
  "schemaVersion": 4,
  "id": "my-template",
  "name": "我的模板",
  "version": "1.0.0",
  "description": "用可见对象和反馈讲解机制。",
  "scenarios": ["阅读机制与证据。"],
  "guides": ["guides/reader.md", "guides/scenes.md"],
  "components": []
}
```

guides 按阅读顺序列出 `guides/` 下的 Markdown 指南，最多 20 个，可以为空。Agent 一次读完所选模板，所以指南只写这类内容需要的方法，按内容需要组织；各环节及其记录由制作流程规定。README 正文上限 4 KiB，单个指南 32 KiB，全部指南合计 48 KiB。组件列表可空。应用模板总是创建空白 Page：本次实例的呈现逻辑与设计稿决定页面结构，而不是保存的骨架。

按阶段组织的旧模板继续可读。schemaVersion 3 把理解意图、收集材料、呈现逻辑、设计稿四个阶段分别映射到指南；schemaVersion 1、2 声明六个阶段（intent、evidence、understanding、design、authoring、review），schemaVersion 1 还可带 page.json 骨架。template_context 按阶段顺序返回它们的指南；六阶段模板只返回 intent、evidence、understanding 与 design 指南，不返回 authoring 与 review。新模板使用 schemaVersion 4。

每个任务上下文都包含 system-presentation 引用。它的 README 与指南从同一来源嵌入 show-document Skill；无本机 Skill 的宿主用 `guide({topic:"presentation"})` 读取同样的内容。项目模板不能替代或关闭 system-presentation。模板指南通过 template_context 读取，不安装为 Skill。旧 document/composition/contentGuide 模板继续可读。

## 内置模板

| ID                    | 用途                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------ |
| `system-presentation` | 必须遵循的制作流程：七个环节、各环节的记录与视觉表达原则                             |
| `paper-explainer`     | 论文的可交互讲解：从背景与动机起层层递进，问题 → 机制 → 实验口径 → 证据 → 条件与局限 |
| `blank`               | 仅供 Studio"新建页面"内部使用，不出现在 Agent 目录                                   |

`paper-explainer` 从两篇已验证的讲解页（VideoJev、Terminal-RSI）提炼。它的设计指南按读者任务命名组件能力；项目或全局的模板副本附带对应组件库时，template_context 返回精确引用，否则指南列出内置替代。

## 组件库

声明为 `{id:"sequence",path:"components/sequence"}`，manifest 使用此本地 ID 与现有组件契约。包内文本与 base64 图片/字体随包保存。内部依赖声明本地 ID 和精确版本，注册时解析指纹；外部依赖保留精确引用。

保存/导入会真实编译并分配隔离 ID，不同模板可以使用相同本地 ID。组件代码变化需提升组件版本，指南/结构变化提升模板版本。上下文返回实际组件身份，不猜测生成 ID，也不在读取时重复注册。

导入拒绝符号链接、越界路径、不安全名称与大小写冲突；文件夹和网络输入使用相同校验。上限 200 文件、30 组件、16 MiB。template_context 响应有 64 KiB 预算，超出时少选几个模板或缩短指南；指南内容不会被静默截断。

## MCP 工作流

1. 检查 templateWorkflow.protocol 为 showai-template-workflow-v3，并确定真实授权项目。
2. 一次读完制作流程：已加载的 show-document Skill 包含全文；无 Skill 的宿主调用 `guide({topic:"presentation"})`。
3. 按 scenarios 从 `catalog_list({kind:"template",projectId})` 中选择模板，没有合适的就不用模板。`template_context({projectId,templates:[{id,scope,version?,integrity?}]})` 返回每个所选模板的 README、全部指南和带精确引用的分页组件目录。一次读完，在各环节叠加使用。knownHash 仅用于实际持有的上下文，按 componentPage.next 继续。
4. 把各环节的记录写进 `showai_capabilities.authoring.workRecords` 返回的记录目录，每份作品一个文件夹：`brief.md`（读者简报）、`material.md`（材料底稿）、`presentation-plan.json`（nodes 为呈现规划，scenes 为设计稿）和 `review.md`（评审记录）。第一次写入页面之前，用 show-document Skill 的 `scripts/check_plan.py` 检查规划。没有文件系统的远程连接把记录写在对话里。
5. template_apply 应用模板（绑定精确引用的空白 Page），或遵循用户的空白页选择；按设计稿制作页面。
6. 保留当前 hash/revision 保存，再展示。page_read 的 response:source 返回完整源，receipt 返回身份/写入回执，默认 full 保持兼容。

Page.templateContext 保留 format/system/templates 精确引用供续改，不保存 context 响应 hash。可用 page.set 明确修改。引用不授予跨项目权限；缺失旧版本需报告或导入，不能猜用最新版。

每次任务或连接的模板选择独立，不修改全局当前模板。省略 templates 使用启动默认；显式 [] 清除本次选择，只保留系统流程引用。knownHash 不绕过授权/身份检查。

网络保存使用 `template_save({projectId,input:{bundle:{format:1,files,assets?}}})`：files 映射相对路径到 UTF-8，assets 映射资源路径到 base64。网页不能传服务器本地目录。

匿名客户端可查内置文件夹模板和系统流程模板，public_catalog_describe 可指定 version/integrity，view:"guide" 返回模板的 README 与全部指南；render_document 可通过 templateId/templateVersion/templateIntegrity 实例化。项目模板与注册需要授权。

## 本机管理与宿主

```sh
showai template import ./my-template --project PROJECT --json
showai template export my-template --project PROJECT --out ./new-folder --json
showai template context --project PROJECT --templates my-template@1.0.0 --json
showai mcp --project PROJECT --templates my-template@1.0.0
```

启动 --templates 需要 --project；library/HTTP 用工具选择。插件支持 SHOWAI_TEMPLATES 与 SHOWAI_PROJECT_ID。CLI 管理本机目录，Agent 文档操作使用 MCP。

Codex 包使用 plugin.json/mcp.json，Claude Code 使用 .claude-plugin/plugin.json/.mcp.json。远程包改用 HTTPS；ChatGPT 直接从 endpoint 读取制作流程与模板指南，并按 OAuth 权限操作，无需本机插件。更新 Skill 不自动更新已运行软件/MCP；launcher 会检查协议并报告不兼容。
