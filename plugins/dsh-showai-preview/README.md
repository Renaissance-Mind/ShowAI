# ShowAI page preview for DeepSeek Harness

**Language:** [English](#english) | [简体中文](#简体中文)

## English

A Harness bundle that renders a presented ShowAI page **inside the conversation**
instead of collapsing it into the generic JSON tool card.

The plugin takes over the Tool call view of the two ShowAI presentation tools
(`mcp__showai__page_present` and `mcp__showai__render_document`) and frames the
delivered page under a status row with reload, expand, open-in-a-new-tab and
open-the-full-HTML actions.

## Why a plugin is needed

A ShowAI presentation answer carries its compiled page **as file paths**
(`data.delivery.inline`, `data.delivery.html`) in the model-facing text blocks,
while the page itself travels in the MCP `_meta.showai.inline` payload that an
MCP Apps host renders. The Harness MCP bridge keeps the text blocks and drops
`_meta`, so nothing on the page can show the document by itself. This bundle
closes that gap without changing the wire contract.

## How it works

Host half (`index.js`):

1. Observes the settled `tools/result` of a ShowAI presentation tool and copies
   the delivered HTML into `$DSH_HOME/cache/showai-page/<callId>.html`.
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

## Install

The bundle is installed into a Harness profile, not into a project:

```text
plugin_manager install_bundle target=/absolute/path/to/plugins/dsh-showai-preview
```

That links the package into the active profile, adds it to
`dsh.profile.bundles`, and inserts the `showai-preview` row from
`cordis.patch.yml`. The bundle needs no build step and no dependencies.

## Limits and notes

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

此 Harness bundle 将 ShowAI page_present 与 render_document 的结果呈现在对话中，提供刷新、展开、新标签页与完整 HTML 操作。

ShowAI 返回 delivery.inline/html 文件路径与 MCP _meta.showai.inline。Harness 桥保留文字但不传递 _meta，因此本 bundle 在工具结果完成后把 HTML 复制到 $DSH_HOME/cache/showai-page/<callId>.html，并从独立随机 loopback origin 提供。该 origin 无法读取 Harness DOM、会话或 /api，同时可使用自己的存储与 worker。

delivery.html 已是完整文件，按原字节保存；delivery.inline 通常是供宿主嵌入的阅读器片段，缓存会补上 doctype、head 与 body 外壳。直接以片段作为文档加载会进入 quirks mode，导致 KaTeX 停用并改变布局；旧缓存片段在读取时也会补外壳。client.js 为两个工具注册 tool.call.toolview，使用 sandbox iframe 显示；可用性探测会短暂重试，因为宿主在结果之后异步写入缓存。预览用 delivery.inline，而“打开完整 HTML”使用 delivery.html；“局部”标签只在调用确实带 blockIds 选择时出现。缓存保留最近 40 页，进程重启后旧对话仍可读取。

安装到 Harness profile：

```text
plugin_manager install_bundle target=/absolute/path/to/plugins/dsh-showai-preview
```

安装注册 dsh.profile.bundles 与 cordis.patch.yml 的 showai-preview 行，无需构建或额外依赖。需要 profile 的 webServer；超过 12 MiB 的预览不缓存，退回文件操作。Host 代码更新需新进程，client.js 可由 HMR 更新。此包提供展示，不替代 MCP 连接、项目保存或同步。
