# 宿主显示与完整交付

对话展示使用 show_component，不保存；正式页面保存后用 page_present；完整独立文件用 render_document。保存位置由项目连接决定，展示输出目录由宿主或运行时配置。

## 当前插件的展示契约

展示前读取 [当前宿主适配](host-adapter.md)。安装包在构建时绑定这份文件，Agent 只执行该契约，不从其他 Harness 猜测展示语法。host-profile.json 记录适配身份、声明的显示能力、公共 Skill 指纹与适配指纹，供安装和诊断核验；普通创作无需读取它。

showai_capabilities.presentation.declaredHostDisplay 回显连接声明，show_component 的 delivery:auto 按声明选择；以工具实际返回的 delivery.mode 交付。声明与插件指南不一致时，先核对所选连接、安装版本和宿主能力。配置更新后旧 MCP 进程可能仍沿用此前声明，重连与宿主加载分别验证。

使用已绑定契约支持的交付方式。缺少契约或实际能力时说明缺项，保留源内容和可用文件；用户明确选择另一入口后再按其真实契约交付。工具成功、资源已附带、文件已生成、用户实际看到分别核对。

## 文件、在线阅读器与隐私

delivery.inline 是可内嵌的阅读片段；delivery.html 是完整离线 HTML；delivery.source 是源内容。片段可有宿主拥有的本机路径，远程连接也可返回带期限的 URL。URL 不能当成本机 path；不通过本机文件操作读取远程服务端路径。

inline 优先携带压缩后的本地阅读器；超出预算时才切换到在线阅读器。delivery.compact 与 delivery.online 只带页面数据和在线阅读器引用：compact 用于宿主的 HTML 展示工具，online 是独立网页。阅读器从 ShowAI 阅读器源、jsDelivr、unpkg 依次加载；没有控制台证据时不直接断言某个来源被拦截。display 的 available 字段仅说明文件或资源存在，不证明加载与交互正常。

显式 page_export 的 reader:bundled 强制离线，reader:cdn 使用在线阅读器。加载失败时按绑定的宿主契约处理，并保留可用的离线文件。插件安装不会更新独立的软件运行时。

结果带 externalSnapshots 时，交付物含内容库以外文件的数据快照；对话中查看无需额外询问，交给别人或上传前按 [共享数据](shared-data.md#外部文件中的数据) 核对大小并取得同意。

## 读者上下文

接受模型上下文的宿主会把预览里的控件最新取值以 showai.readerState 交回对话，含 blockId、控件标签与取值。这是本地阅读状态，未写入页面。用户要求保留时，再按正常流程读取并保存。

同一预览的引用与主动交出的组件状态分别是 showai.reference、showai.components，见 [处理用户引用](../SKILL.md#处理用户引用)。不能把读者状态当作页面已保存的内容。

## 路径与持久性

本机 page_present 默认在连接库的 local/agent-previews 生成交付物；SHOWAI_PRESENTATION_DIR 可指定宿主拥有的输出目录。show_component 的文件式预览只保留最近 20 份，是临时对话展示。页面身份、项目归属与保存状态按回执判断，预览文件不能代替源 Page。

远程交付地址可能到期。长期文件交付使用完整离线 HTML；完整源 Page 是继续编辑的依据。render_document 返回 savedToProject:false；page_present 返回已保存页面的身份、hash 和 revision。同步单独看 synchronization；not_checked 不表示远端已更新。

## 局部预览

用户未指定范围时先展示完整页面；明确要求局部时按真实 blockIds 选择。完整预览超限时先读完整源取得节点 ID，再选择独立可理解的区域。初始视口高度有限与只导出部分节点是两回事。

page_present 的 blockIds 只影响 inline 预览，完整 HTML/source 保留全页。page_export 的 blockIds 会使导出文件及同名 source 本身成为局部投影，不能用它覆盖完整源 Page。组件内部章节不一定是独立页面节点，选择前核实。
