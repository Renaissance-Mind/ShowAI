# ShowAI Agent plugin

ShowAI Agents use MCP for page, component, template and presentation operations. The local package includes four skills and a stdio MCP launcher. Remote packaging uses the same skills with an authorized HTTP endpoint. CLI remains available for service startup, diagnostics, scripts and explicit administration.

Read [use-showai](skills/use-showai/SKILL.md) for connection identity, project selection and task routing. Formal content is saved in the selected project before presentation. Explicitly standalone work uses render_document and reports that no personal project was saved.

The local launcher uses the selected library's registered ShowAI runtime. It requires Node.js 22.12+ and runtime capability `showai-mcp-v1`; installing skills does not upgrade the software. Configure SHOWAI_HOME, optional SHOWAI_PROJECT_ID and optional SHOWAI_PRESENTATION_DIR in the host. The launcher does not silently search for another library or runtime after a failure. See [connection setup](skills/use-showai/references/runtime.md).

`page_present` returns full HTML/source and an optional selected inline preview. The host displays the attached MCP Apps reader, uses a local Codex visualization reference, opens the full HTML, or reports the saved Page when it has no display surface. Output locations are owned by the host/runtime, not chosen by the model. See [delivery](skills/show-document/references/conversation-display.md).

From the source repository, run `npm run plugin:update -- --json`. It uses the official Codex plugin commands and verifies the installed files. Refresh the host's connections and verify tools are visible; file installation alone does not prove an existing conversation has reloaded its capabilities. Do not restart the host without coordinating ongoing tasks.

For a remote package, run `npm run package:plugin -- --mcp-url HTTPS_MCP_URL --out NEW_DIRECTORY`. This replaces the local mcp.json with the chosen remote endpoint. No credentials enter the bundle. Publication and production deployment are separate operations.

An embedded ShowAI Agent receives its project-bound MCP from AgentHost. Its task-private skill package omits the external library launcher, so the embedded runner does not gain another library-wide connection.
