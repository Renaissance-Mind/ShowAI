// Compatibility entry point for the unified Page/Board acceptance flow.
if (process.env.SHOWAI_V2_CLI)
  process.env.SHOWAI_CONTAINERS_CLI = process.env.SHOWAI_V2_CLI;
if (process.env.SHOWAI_V2_NODE)
  process.env.SHOWAI_CONTAINERS_NODE = process.env.SHOWAI_V2_NODE;
await import("./containers-smoke.mjs");
