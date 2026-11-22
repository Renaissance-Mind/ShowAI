# 宿主显示与完整交付

临时组件用 `show_component` 展示。新建或修改正式页面后，核对保存回执，再按[当前宿主适配](host-adapter.md)交付原页。完整独立文件用 `render_document`。保存位置由项目连接决定，展示输出目录由宿主或运行时配置。

## T3 Code

T3 Code 使用线程执行环境中的 ShowAI 连接。核对当前会话的工具，每份内容发布一次。

T3 Code 0.1.11 的 Codex 会话可展示交互式 MCP App。

- 临时图表、原创 HTML 和交互原型使用 `show_component`。支持 MCP App 时传 `delivery:"mcp-app"`，可在图内切换全屏。分批生成已有组件时用本机 stdio 的 `live:true` 和同一 viewId。已保存页面的阅读器可将选区和控件值通过 `ui/update-model-context` 交给下一条消息。

- 使用 MCP App 时，正式 Page 或 Board 保存成功后，用最终 projectId、pageId 调用一次本机 `card_present({projectId,pageId,openIn:"desktop"})`，多页用 additionalTargets。卡片可以带要定位的 blockId。读者点卡片后，T3 请其批准打开操作，随后在运行该连接的电脑上启动 ShowAI App 并定位原页。卡片留在聊天中。

- 用户明确指定在 T3 Browser 中编辑时，调用本机 `workbench_page_url({projectId,pageId,blockId?,surface:"t3-code"})`。用 `preview_status` 核对已有标签，已显示同页时按 tabId 定位；其他页面用 `preview_open({target:previewTarget,reuseExistingTab:false})`。全库入口用 `workbench_url({surface:"t3-code"})`。HTTP MCP 采用该连接实际返回的授权入口。
- 用户要文件时用原有导出工具，给出执行环境的绝对路径链接。图片、音视频和可预览文档可使用 T3 自带的文件查看器。

## 通用交付

宿主未指定专用的原页入口，或当前连接未提供该入口时，新作品默认用 `page_present` 展示，续改默认说明改动、所在项目和可用的页面链接。用户要求在对话里预览已有页面时再用阅读器。用户指定只保存、只导出或直接打开时，按指定方式完成。

## 当前插件的展示契约

可选持续更新使用同一个 MCP App 显示区：服务端 liveUpdates.available 与宿主 serverTools 都须支持。普通 HTML 文件片段、图片和模型填写 HTML 继续一次交付，不能用不断返回新文件来冒充同一实例更新。当前本机持续显示句柄绑定原 MCP 连接；跨重连或 HTTP 连接不承诺恢复。分批调用、完成、读回保存和释放步骤见 show-visual。

show-visual 和 show-document 的「当前宿主交付」包含安装包绑定的常规交付步骤。回执与声明不符、显示失败或需要特殊交付时，查[完整宿主适配](host-adapter.md)。host-profile.json 记录适配身份、显示声明和文件指纹，供安装和诊断核验。

需要核对显示时，`showai_capabilities({view:"presentation"})` 返回 `presentation.declaredHostDisplay` 和 `presentation.show.maxComponents`。show_component 的 delivery:auto 跟随连接声明，以实际返回的 delivery.mode 交付。需要模型自己写 HTML 的宿主中，page_present 与 render_document 另外返回 `conversation`（`mode`、`next`，可展示时带 `fragment`），按它完成展示。声明与插件指南不一致时，核对所选连接、安装版本和宿主能力。

使用已绑定契约支持的交付方式。缺少契约或实际能力时说明缺项，保留源内容和可用文件；用户明确选择另一入口后再按其真实契约交付。工具成功、资源已附带、文件已生成、用户实际看到分别核对。

## 文件、在线阅读器与隐私

delivery.inline 是可内嵌的阅读片段；delivery.html 是完整离线 HTML；delivery.source 是源内容。片段可有宿主拥有的本机路径，远程连接也可返回带期限的 URL。URL 不能当成本机 path；不通过本机文件操作读取远程服务端路径。

inline 优先携带压缩后的本地阅读器；超出预算时才切换到在线阅读器。page_present、render_document 与 show_component 的 display.reader 写明 inline 预览实际用的阅读器，切换到在线阅读器时 display.readerReason 给出原因、大小与上限；交给禁止联网的宿主前先看这两个字段。delivery.compact 与 delivery.online 只带页面数据和在线阅读器引用：compact 用于宿主的 HTML 展示工具，online 是独立网页。阅读器从 ShowAI 阅读器源、jsDelivr、unpkg 依次加载；没有控制台证据时不直接断言某个来源被拦截。display 的 available 字段仅说明文件或资源存在，不证明加载与交互正常。

显式 page_export 的 reader:bundled 强制离线，inline 超出对话预算时直接报错，并给出大小与上限；reader:cdn 使用在线阅读器。不指定 reader 的 inline 导出超出预算时改用在线阅读器，结果的 reader 为 cdn，readerReason 写明原因、大小与上限；交付需要离线阅读的文件前先看这两个字段。加载失败时按绑定的宿主契约处理，并保留可用的离线文件。插件安装不会更新独立的软件运行时。

结果带 externalSnapshots 时，交付物含内容库以外文件的数据快照；对话中查看无需额外询问，交给别人或上传前按 [共享数据](shared-data.md#外部文件中的数据) 核对大小并取得同意。

## 读者上下文

接受模型上下文的宿主会把预览里的控件最新取值以 showai.readerState 交回对话，含 blockId、控件标签与取值。这是本地阅读状态，未写入页面。用户要求保留时，再按正常流程读取并保存。

同一预览的引用与主动交出的组件状态分别是 showai.reference、showai.components，见 [用户引用与组件状态](user-references.md)。不能把读者状态当作页面已保存的内容。

## 路径与持久性

本机 page_present 默认在连接库的 local/agent-previews 生成交付物；SHOWAI_PRESENTATION_DIR 可指定宿主拥有的输出目录。show_component 的文件式预览只保留最近 20 份，是临时对话展示。页面身份、项目归属与保存状态按回执判断，预览文件不能代替源 Page。

远程交付地址可能到期。长期文件交付使用完整离线 HTML；完整源 Page 是继续编辑的依据。render_document 返回 savedToProject:false；page_present 返回已保存页面的身份、hash 和 revision。同步单独看 synchronization；not_checked 不表示远端已更新。

## 局部预览

用户未指定范围时先展示完整页面；明确要求局部时按真实 blockIds 选择。完整预览超限时用 page_read 的 `detail:"outline"` 取得节点 ID，再选择独立可理解的区域。初始视口高度有限与只导出部分节点是两回事。

page_present 的 blockIds 只影响 inline 预览，完整 HTML/source 保留全页。page_export 的 blockIds 会使导出文件及同名 source 本身成为局部投影，不能用它覆盖完整源 Page。组件内部章节不一定是独立页面节点，选择前核实。
