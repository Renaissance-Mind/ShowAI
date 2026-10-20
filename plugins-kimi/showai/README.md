# ShowAI for Kimi Work (experimental)

**Language:** [English](#english) | [简体中文](#简体中文)

## English

This directory is a skill-only plugin for Kimi Work. It teaches the agent how to create, revise, read, and display ShowAI pages through the ShowAI MCP tools, and how to show the result with Kimi Work widgets. It does not contain the ShowAI runtime or an MCP launcher.

## Setup

1. Install and start ShowAI (desktop app, or `npm run build:browser` and `npm run browser` from the repository).
2. In Kimi Work, add a local MCP server for ShowAI. Use the start command from ShowAI → **Settings → Plugins → Copy launch configuration**, or run the CLI directly with an absolute content library path:

   ```sh
   node /ABSOLUTE/PATH/TO/ShowAI/dist-runtime/scripts/cli.mjs mcp --home /ABSOLUTE/LIBRARY
   ```

3. Add this directory (`plugins-kimi/showai`) as a local plugin in Kimi Work.
4. Start a new conversation and confirm the ShowAI MCP tools are visible before asking for a page.

See [Agent integration](../../docs/agent-integration.md) for MCP entry points and options.

## 简体中文

本目录为实验性的 Kimi Work 纯 Skill 插件，指导 Agent 通过 ShowAI MCP 创建、续改、读取并使用 Kimi Work widget 展示页面；不带运行时或 MCP launcher。

1. 安装并启动 ShowAI；源码可使用 npm run build:browser 和 npm run browser。
2. 在 Kimi Work 添加本机 MCP，使用 ShowAI「设置 → 插件」中「复制启动配置」得到的启动命令，或 node /ABSOLUTE/PATH/TO/ShowAI/dist-runtime/scripts/cli.mjs mcp --home /ABSOLUTE/LIBRARY。
3. 将 plugins-kimi/showai 目录作为本机插件添加。
4. 按宿主支持的方式刷新并新建对话，确认 ShowAI MCP 工具可见后再创作。

连接类型与选项见 [Agent 接入](../../docs/i18n/agent-integration.zh-CN.md)。实际可见页面由宿主显示能力决定；本说明不代表跨宿主交互已全部验收。
