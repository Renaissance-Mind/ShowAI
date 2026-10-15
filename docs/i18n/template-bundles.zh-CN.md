# 模板文件夹与分阶段呈现

**语言：** [English](../template-bundles.md) | 简体中文 · [文档目录](index.zh-CN.md)

模板打包可复用的方法、可选页面骨架与组件库。运行时提供必需的系统呈现基线，所选模板增加当前阶段指南。本机 Codex/Claude Code 与授权 HTTP MCP 共用此约定。

## 目录与元信息

```text
my-template/
  README.md
  guides/
    01-intent.md
    02-evidence.md
    03-understanding.md
    04-design/README.md
    04-design/detail.md
    05-authoring.md
    06-review.md
  components/sequence/
    manifest.json
    props.schema.json
    index.tsx
  page.json
```

README 以两条 --- 之间的严格 JSON frontmatter 开始，再写简短正文。拒绝仅 YAML 语法与未知字段；显式保存参数必须与元信息一致。

```json
{
  "format": "showai-template",
  "schemaVersion": 1,
  "id": "my-template",
  "name": "我的模板",
  "version": "1.0.0",
  "description": "用可见对象和反馈讲解机制。",
  "scenarios": ["阅读机制与证据。"],
  "guides": {
    "intent": "guides/01-intent.md",
    "evidence": "guides/02-evidence.md",
    "understanding": "guides/03-understanding.md",
    "design": "guides/04-design",
    "authoring": "guides/05-authoring.md",
    "review": "guides/06-review.md"
  },
  "components": [],
  "page": null
}
```

六个阶段都要声明。阶段值可以是 Markdown 文件、有主 README 的文件夹，或 null（继承系统阶段）。README 正文上限 4 KiB，单指南 32 KiB。组件列表可空；不提供页面骨架时应用为空白可编辑 Page。骨架使用当前 Page/Board 格式。

系统基线始终进入任务上下文，并从同一源嵌入 show-document。项目模板不能替代 system-presentation。无本机 Skill 的宿主可用 `guide({topic:"presentation"})` 读取。阶段文件按需查询，不逐个安装为 Skill。旧 document/composition/contentGuide 模板继续可读。

## 组件库

声明为 `{id:"sequence",path:"components/sequence"}`，manifest 使用此本地 ID 与现有组件契约。包内文本与 base64 图片/字体随包保存。内部依赖声明本地 ID 和精确版本，注册时解析指纹；外部依赖保留精确引用。

保存/导入会真实编译并分配隔离 ID，不同模板可以使用相同本地 ID。组件代码变化需提升组件版本，指南/结构变化提升模板版本。上下文返回实际组件身份，不猜测生成 ID，也不在读取时重复注册。

导入拒绝符号链接、越界路径、不安全名称与大小写冲突；文件夹和网络输入使用相同校验。上限 200 文件、30 组件、16 MiB。上下文与组合阶段响应各有 64 KiB 预算，超限要拆分或单独查询，不静默截断。

## MCP 工作流

1. 检查 templateWorkflow.protocol 为 showai-template-workflow-v1，并确定真实授权项目。
2. 读取系统基线，或复用本会话已加载的相同基线。
3. `template_context({projectId,templates:[{id,scope,version?,integrity?}]})` 返回 README、固定引用和分页组件目录。knownSystemHash/knownHash 仅用于实际持有的文本，按 componentPage.next 继续。
4. `template_guide({projectId,stage,templates:context.templates})` 返回系统阶段与精确模板指南。文件夹阶段按所列文件，用 templateId/file 读取子文件。
5. template_apply 应用匹配模板，或遵循用户的空白页选择；填入真实材料并检查关键状态。
6. 保留当前 hash/revision 保存，再展示。page_read 的 response:source 返回完整源，receipt 返回身份/写入回执，默认 full 保持兼容。

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
