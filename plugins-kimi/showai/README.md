# ShowAI for Kimi Work (experimental)

This directory is a skill-only plugin for Kimi Work. It teaches the agent how to create, revise, read, and display ShowAI pages through the ShowAI MCP tools, and how to show the result with Kimi Work widgets. It does not contain the ShowAI runtime or an MCP launcher.

## Setup

1. Install and start ShowAI (desktop app, or `npm run build:browser` and `npm run browser` from the repository).
2. In Kimi Work, add a local MCP server for ShowAI. Use the start command shown in ShowAI under 设置 → 连接 Agent, or run the CLI directly with an absolute content library path:

   ```sh
   node /ABSOLUTE/PATH/TO/ShowAI/dist-runtime/scripts/cli.mjs mcp --home /ABSOLUTE/LIBRARY
   ```

3. Add this directory (`plugins-kimi/showai`) as a local plugin in Kimi Work.
4. Start a new conversation and confirm the ShowAI MCP tools are visible before asking for a page.

See [Agent integration](../../docs/agent-integration.md) for MCP entry points and options.
