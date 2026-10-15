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
2. Serves that cache from a dedicated loopback origin (`127.0.0.1:<random>`), so
   the page runs in **its own origin**: its scripts cannot read the Harness DOM,
   session data or `/api`, while they keep a real origin for storage and workers.
3. Registers one same-origin route on the Harness web server,
   `/showai-page-preview/<callId>.html`, which answers the card's `HEAD`
   availability probe from the cache and `302`s a real load to the preview
   origin. The browser gets no CORS access to that origin, only a navigation.

Client half (`client.js`):

4. Registers the keyed `tool.call.toolview` views for the two ShowAI tools and
   renders the row plus a sandboxed `<iframe>`.

Because the cache is on disk, the preview survives a restart: replaying an old
transcript still renders the page it presented. The cache keeps the newest 40
previews.

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

Harness 同源 /showai-page-preview/<callId>.html 用于 HEAD 可用性检查，真正导航以 302 转向独立预览 origin；浏览器没有跨域读取权限。client.js 为两个工具注册 tool.call.toolview，使用 sandbox iframe 显示。缓存保留最近 40 页，进程重启后旧对话仍可读取。

安装到 Harness profile：

```text
plugin_manager install_bundle target=/absolute/path/to/plugins/dsh-showai-preview
```

安装注册 dsh.profile.bundles 与 cordis.patch.yml 的 showai-preview 行，无需构建或额外依赖。需要 profile 的 webServer；超过 12 MiB 的预览不缓存，退回文件操作。Host 代码更新需新进程，client.js 可由 HMR 更新。此包提供展示，不替代 MCP 连接、项目保存或同步。
