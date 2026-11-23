# ShowAI for DeepSeek Harness

**Language:** [English](#english) | [简体中文](#简体中文)

## English

One Harness bundle supplies everything ShowAI needs in DeepSeek Harness:

| Row | Module | Purpose |
| --- | --- | --- |
| `showai-mcp` | `@deepseek-ai/dsh-mcp-client` | The ShowAI MCP tools (`mcp__showai__*`), started through the bundled launcher with this machine's ShowAI runtime and library. |
| `showai-skills` | `@showai/dsh-showai/skills` | The ShowAI agent Skills from [ShowAI](https://github.com/Renaissance-Mind/ShowAI/tree/main/plugins/showai-deepseek), published at the Harness bundled-skill rank. |
| `showai-preview` | `@showai/dsh-showai` | Shows inline previews and opens the editable library in a session sidebar tab or the global ShowAI panel. |

Open DeepSeek Harness Desktop once, then quit it completely. Choose **Settings → Agent plugins → DeepSeek Harness → Install plugin** in ShowAI. ShowAI stages the runtime and library binding, calls the Harness desktop CLI and checks that the package is linked and enabled. Open Harness to load it. After an update or library change, use **Update and enable** in ShowAI and reopen Harness.

For a source build, `npm run plugin:dsh` prepares this directory with the Skills, launcher and MCP configuration. Its default output is `$DSH_HOME/plugins/showai`. Use the path printed by the command with `dsh plugin --profile desktop add "link:/absolute/bundle/path"` while Harness is closed. For a manual install, use **Plugins → Add plugin → Enable now** in Harness. Remove earlier hand-made setups first: the
`@showai/dsh-showai-preview` bundle (Harness Plugins → the bundle → Uninstall),
a hand-written `mcp-showai` row in `$DSH_HOME/profiles/desktop/cordis.patch.yml`, and
ShowAI Skill folders copied into `$DSH_HOME/skills`, which rank above bundled
Skills and would shadow them. The installer lists whichever of these it finds.

## Inline page preview

| Surface | Open it | What you can do |
| --- | --- | --- |
| Conversation | Ask for a visual or save a Page | Use the interactive preview for reading, or click a saved-Page card to edit its original. |
| Session sidebar | Click a saved-Page card or select ShowAI in the right sidebar | Edit the original Page alongside chat. The Page or selection menu can append a versioned reference to this conversation's draft. Harness owns the tab's split, fullscreen and floating controls. |
| Main workbench | Select **ShowAI** in the left navigation | Browse projects and edit Pages in the bound library. Select the conversation to return. |

The graphical surfaces use the Harness Web UI that ships in the desktop app and the local Web profile. The editor starts on demand from the same registered ShowAI runtime as MCP. The local Harness origin and a private editor URL scope each connection. A terminal-only profile can use the MCP tools and file links.

The preview row renders a presented ShowAI page **inside the conversation**
instead of collapsing it into the generic JSON tool card.

The plugin takes over the Tool call view of the three ShowAI presentation tools
(`mcp__showai__show_component`, `mcp__showai__page_present` and `mcp__showai__render_document`) and frames the
delivered page under a status row with reload, expand, open-in-a-new-tab and
open-the-full-HTML actions.

`mcp__showai__card_present` delivers compact original-Page cards. When the conversation has a side panel, the card opens its saved target there and the dropdown offers the ShowAI App. With only the App available, the card has a single **Open in ShowAI** button.

### Why the preview is needed

A ShowAI presentation answer carries its compiled page **as file paths**
(`data.delivery.inline`, `data.delivery.html`) in the model-facing text blocks,
while the page itself travels in the MCP `_meta.showai.inline` payload that an
MCP Apps host renders. The Harness MCP bridge keeps the text blocks and drops
`_meta`, so nothing on the page can show the document by itself. This bundle
closes that gap without changing the wire contract.

### How the preview works

Host half (`index.js`):

1. Observes the settled `tools/result` of a ShowAI presentation tool and copies
   the delivered HTML into `$DSH_HOME/cache/showai-page/<callId>.html`. Long IDs and IDs with punctuation use a SHA-256 cache key. Both
   root calls and PTC subcalls are handled, because both reach the same keyed
   Client view.
2. Turns the delivered file into a complete document. `delivery.html` is already
   complete and is kept byte-for-byte; `delivery.inline` is normally an inline
   reader **fragment**, so the cache adds a doctype, head and body shell. Without
   that shell the preview runs in quirks mode, where KaTeX is disabled and some
   layout rules differ. Legacy fragment cache entries are wrapped when read.
3. Serves that cache from a dedicated loopback origin (`127.0.0.1:<random>`), so
   the page runs in **its own origin**: its scripts cannot read the Harness DOM,
   session data or `/api`, while they keep a real origin for storage and workers.
4. Registers one same-origin route on the Harness web server,
   `/showai-page-preview/<callId>.html`, which answers the card's `HEAD`
   availability probe from the cache. Complex IDs use `/showai-page-preview/by-id?callId=…`. A real load redirects to the preview
   origin. The browser gets no CORS access to that origin, only a navigation.

Client half (`client.js`):

5. Registers the keyed `tool.call.toolview` views for the three ShowAI tools and
   renders the row plus a sandboxed `<iframe>`. The availability probe retries
   briefly because the Host caches the file asynchronously after the result.
6. Uses `delivery.inline` for the framed preview and `delivery.html` for the
   "open the full HTML" action, so that action never opens the partial inline
   build. The "Partial" label appears only when the call actually selected
   blocks with `blockIds`.

Because the cache is on disk, the preview survives a restart: replaying an old
transcript still renders the page it presented. The cache keeps the newest 40
previews.

Run the Host regression test from this directory:

```text
npm test
```

## Limits and notes

- The bundle needs no build step and no dependencies. A Harness agent can also
  install the staged directory with `plugin_manager install_bundle target=<path>`.
- Staging binds the MCP row to one ShowAI library and runtime command; prepare
  the plugin again after switching libraries, moving the App or changing the
  registered runtime.

- The Host half requires the profile's `webServer`. Without the Web carrier the
  row stays inactive rather than activating a service it cannot use.
- A preview above 12 MiB is not cached; the card then falls back to the tool
  output and the open-the-file action.
- The preview origin binds loopback only. Preview files stay in the Harness
  cache directory and are pruned to the newest 40.
- Reloading plugin code needs a fresh process generation: a Harness restart
  loads a changed JavaScript module, while `client.js` changes reach an open
  page through the client HMR path.

## 简体中文

在聊天中看图时，工具结果和回合末尾都提供交互预览。会话提供侧栏时，点击原页卡片在右侧打开编辑器，箭头可改选 ShowAI App。仅桌面 App 可用时，卡片显示单个「从 ShowAI 打开」按钮。在侧栏编辑器中可以把页面或选区引用放进当前对话草稿，也可以用宿主的全屏、分栏或浮动控件调整空间。左侧导航的 ShowAI 打开全局工作台。以上入口共用安装时绑定的本机内容库。

此 Harness bundle 提供 ShowAI 在 DeepSeek Harness 中所需的全部内容：`showai-mcp` 行通过 bundle 内的启动器连接本机 ShowAI 运行时与内容库，提供 `mcp__showai__*` 工具；`showai-skills` 行以 Harness 内置 Skill 的优先级发布 [ShowAI](https://github.com/Renaissance-Mind/ShowAI/tree/main/plugins/showai-deepseek) 的 Skill；`showai-preview` 行在对话中显示页面。

首次打开 DeepSeek Harness 后完全退出，在 ShowAI「设置 → Agent 插件 → DeepSeek Harness」点「安装插件」。ShowAI 准备绑定当前内容库的插件包，通过 Harness CLI 安装并核验启用状态。打开 Harness 即可使用。源码方式可以用 `npm run plugin:dsh` 准备目录，然后运行 `dsh plugin --profile desktop add "link:/插件包的绝对路径"`。使用图形界面手动安装时，在 Harness「插件 → 添加插件」选择该目录并点「立即启用」。

预览行将 show_component、page_present 和 render_document 的结果呈现在对话中，提供刷新、展开、新标签页与完整 HTML 操作。

ShowAI 返回 delivery.inline/html 文件路径与 MCP _meta.showai.inline。Harness 桥保留文字但不传递 _meta，因此本 bundle 在工具结果完成后把 HTML 保存到 $DSH_HOME/cache/showai-page/。较长或带特殊字符的调用 ID 使用 SHA-256 缓存键。插件从独立的本机 HTTP 地址提供预览。该 origin 无法读取 Harness DOM、会话或 /api，同时可使用自己的存储与 worker。

delivery.html 已是完整文件，按原字节保存；delivery.inline 通常是供宿主嵌入的阅读器片段，缓存会补上 doctype、head 与 body 外壳。直接以片段作为文档加载会进入 quirks mode，导致 KaTeX 停用并改变布局；旧缓存片段在读取时也会补外壳。client.js 为三个工具注册 tool.call.toolview，使用 sandbox iframe 显示；可用性探测会短暂重试，因为宿主在结果之后异步写入缓存。预览用 delivery.inline，而“打开完整 HTML”使用 delivery.html；“局部”标签只在调用确实带 blockIds 选择时出现。缓存保留最近 40 页，进程重启后旧对话仍可读取。

插件包无需额外的构建依赖。Harness 内的 Agent 也可用 `plugin_manager install_bundle target=<路径>` 安装准备好的目录。准备时 MCP 行绑定一个 ShowAI 内容库与运行时命令，切换内容库、移动 App 或更换登记的运行时后，可先完全退出 Harness，再在 ShowAI「设置 → Agent 插件」点「更新并启用」，然后打开 Harness。预览需要 profile 的 webServer；超过 12 MiB 的预览不缓存，退回文件操作。Host 代码更新需新进程，client.js 可由 HMR 更新。

## Shared workflow source

Preparing the bundle copies the canonical ShowAI Skills and binds only the DeepSeek Harness delivery guide from `plugins/showai/host-adapters/deepseek.md`. `host-profile.json` records the shared workflow fingerprints and the selected display contract. The preview adapter automatically displays presentation tool results; the Agent only adds an explanation. Refreshing the bundle requires a Harness reload to activate the new files.
