# ShowAI page preview for DeepSeek Harness

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
