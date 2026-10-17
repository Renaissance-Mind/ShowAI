# ShowAI for DeepSeek Harness

**Language:** [English](#english) | [简体中文](#简体中文)

## English

One Harness bundle supplies everything ShowAI needs in DeepSeek Harness:

| Row | Module | Purpose |
| --- | --- | --- |
| `showai-mcp` | `@deepseek-ai/dsh-mcp-client` | The ShowAI MCP tools (`mcp__showai__*`), started through the bundled launcher with this machine's ShowAI runtime and library. |
| `showai-skills` | `@showai/dsh-showai/skills` | The ShowAI agent Skills from [plugins/showai](../showai/README.md), published at the Harness bundled-skill rank. |
| `showai-preview` | `@showai/dsh-showai` | Renders a presented ShowAI page inside the conversation. |

This directory is the bundle **source**. The MCP row needs absolute paths, so it
is installed from a **staged** copy that adds the Skills, the MCP launcher and
the `showai-mcp` row:

- ShowAI App: **Settings → Plugins → DeepSeek Harness → Prepare plugin**;
- source checkout: `npm run plugin:dsh` (default directory `$DSH_HOME/plugins/showai`;
  `$DSH_HOME` is `~/.dsh` unless set).

Then, once, in DeepSeek Harness: **Plugins → Add plugin**, paste the staged path,
choose **Enable now**, and restart Harness. Harness records a `link:` to the
staged directory, so later updates restage it in place; prepare again after
updating ShowAI, switching libraries or changing the registered runtime, then
restart Harness. Remove earlier hand-made setups first: the
`@showai/dsh-showai-preview` bundle (Harness Plugins → the bundle → Uninstall),
a hand-written `mcp-showai` row in `$DSH_HOME/profiles/desktop/cordis.patch.yml`, and
ShowAI Skill folders copied into `$DSH_HOME/skills`, which rank above bundled
Skills and would shadow them. The installer lists whichever of these it finds.

## Inline page preview

The preview row renders a presented ShowAI page **inside the conversation**
instead of collapsing it into the generic JSON tool card.

The plugin takes over the Tool call view of the two ShowAI presentation tools
(`mcp__showai__page_present` and `mcp__showai__render_document`) and frames the
delivered page under a status row with reload, expand, open-in-a-new-tab and
open-the-full-HTML actions.

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
   the delivered HTML into `$DSH_HOME/cache/showai-page/<callId>.html`. Both
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
   availability probe from the cache and `302`s a real load to the preview
   origin. The browser gets no CORS access to that origin, only a navigation.

Client half (`client.js`):

5. Registers the keyed `tool.call.toolview` views for the two ShowAI tools and
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

此 Harness bundle 提供 ShowAI 在 DeepSeek Harness 中所需的全部内容：`showai-mcp` 行通过 bundle 内的启动器连接本机 ShowAI 运行时与内容库，提供 `mcp__showai__*` 工具；`showai-skills` 行以 Harness 内置 Skill 的优先级发布 [plugins/showai](../showai/README.md) 的 Skill；`showai-preview` 行在对话中显示页面。

本目录是 bundle 源码。MCP 行需要绝对路径，因此安装的是准备后的副本，其中加入 Skill、MCP 启动器与 `showai-mcp` 行：ShowAI App 中使用「设置 → 插件 → DeepSeek Harness → 准备插件」，源码方式执行 `npm run plugin:dsh`（默认目录 `$DSH_HOME/plugins/showai`，`$DSH_HOME` 未设置时为 `~/.dsh`）。随后在 DeepSeek Harness 中执行一次「插件 → 添加插件」，粘贴该路径，选择「立即启用」并重启。Harness 记录指向该目录的 `link:`，更新 ShowAI、切换内容库或登记的运行时变化后再准备一次，会原地重写，重启即可加载。先移除旧的手动配置：`@showai/dsh-showai-preview` bundle（Harness「插件」中打开它并卸载）、`$DSH_HOME/profiles/desktop/cordis.patch.yml` 中手写的 `mcp-showai` 行，以及复制到 `$DSH_HOME/skills` 的 ShowAI Skill 文件夹（其优先级高于 bundle，会覆盖 bundle 的 Skill）。安装器会列出发现的这些项目。

预览行将 ShowAI page_present 与 render_document 的结果呈现在对话中，提供刷新、展开、新标签页与完整 HTML 操作。

ShowAI 返回 delivery.inline/html 文件路径与 MCP _meta.showai.inline。Harness 桥保留文字但不传递 _meta，因此本 bundle 在工具结果完成后把 HTML 复制到 $DSH_HOME/cache/showai-page/<callId>.html，并从独立随机 loopback origin 提供。该 origin 无法读取 Harness DOM、会话或 /api，同时可使用自己的存储与 worker。

delivery.html 已是完整文件，按原字节保存；delivery.inline 通常是供宿主嵌入的阅读器片段，缓存会补上 doctype、head 与 body 外壳。直接以片段作为文档加载会进入 quirks mode，导致 KaTeX 停用并改变布局；旧缓存片段在读取时也会补外壳。client.js 为两个工具注册 tool.call.toolview，使用 sandbox iframe 显示；可用性探测会短暂重试，因为宿主在结果之后异步写入缓存。预览用 delivery.inline，而“打开完整 HTML”使用 delivery.html；“局部”标签只在调用确实带 blockIds 选择时出现。缓存保留最近 40 页，进程重启后旧对话仍可读取。

bundle 无需构建或额外依赖；Harness 内的 Agent 也可用 `plugin_manager install_bundle target=<路径>` 安装准备好的目录。准备时 MCP 行绑定一个 ShowAI 内容库与运行时命令，切换内容库、移动 App 或登记的运行时变化后需重新准备。预览需要 profile 的 webServer；超过 12 MiB 的预览不缓存，退回文件操作。Host 代码更新需新进程，client.js 可由 HMR 更新。
