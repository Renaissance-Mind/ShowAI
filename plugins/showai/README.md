# ShowAI plugin

The plugin provides a skill and a bundled React document viewer. It runs locally and requires Node.js 20 or later. It does not need an MCP server, an API key, or a background process.

From the ShowAI repository, run `npm run build`. This prepares `assets/viewer.html` and the dependency-free `scripts/render-artifact.mjs` command inside this directory. Keep these generated files when distributing the plugin folder.

The repository's `.agents/plugins/marketplace.json` makes **ShowAI Local** available to compatible Codex desktop clients. After building, restart the desktop app, open its plugin directory, choose ShowAI Local, and install ShowAI. The repository setup does not install or enable the plugin automatically. Use the desktop app to verify installation on the actual target client.

Try the packaged command:

```sh
node plugins/showai/scripts/render-artifact.mjs examples/welcome.showai.json ./output/welcome.html
```

The resulting HTML includes the viewer runtime and styles. The command requires embedded raster images and rejects external image URLs. The ShowAI browser app can download and embed remote images during HTML export; if a server blocks that request, upload the local image and retry. Links to source websites still require a network connection when opened. Reader controls such as chart series, table search, and calculator inputs are available in the exported document, while source editing takes place in the ShowAI application or JSON file.

Packaging follows [OpenAI's plugin package documentation](https://developers.openai.com/plugins/build/plugins). Desktop installation and public directory publication are separate steps.
