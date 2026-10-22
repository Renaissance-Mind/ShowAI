/** A stdio MCP server as hosts configure it. */
export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export type LaunchSnippetKind = "claude" | "codex" | "json";

function shellQuote(value: string, platform?: string) {
  if (platform === "win32")
    return /^[\w./:\\-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
  return /^[\w./:=@%+-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** TOML basic strings accept JSON string escapes. */
const toml = (value: string) => JSON.stringify(value);

/**
 * Configuration text for adding ShowAI by hand. `server` is the plugin launcher
 * (checks the registered runtime, then starts its `mcp` entry) or, without one,
 * the runtime CLI with the `mcp` subcommand appended.
 */
export function launchSnippet(
  kind: LaunchSnippetKind,
  server: McpLaunch,
  platform?: string,
) {
  const env = Object.entries(server.env);
  if (kind === "claude")
    return [
      // -e takes several values, so the name comes first and `--` ends the options.
      "claude mcp add --scope user showai",
      ...env.map(([key, value]) => `-e ${shellQuote(`${key}=${value}`, platform)}`),
      "--",
      shellQuote(server.command, platform),
      ...server.args.map((arg) => shellQuote(arg, platform)),
    ].join(" ");
  if (kind === "codex")
    return [
      "[mcp_servers.showai]",
      `command = ${toml(server.command)}`,
      `args = [${server.args.map(toml).join(", ")}]`,
      ...(env.length
        ? [
            `env = { ${env.map(([key, value]) => `${/^[A-Za-z0-9_-]+$/.test(key) ? key : toml(key)} = ${toml(value)}`).join(", ")} }`,
          ]
        : []),
    ].join("\n");
  return JSON.stringify(
    {
      mcpServers: {
        showai: {
          command: server.command,
          args: server.args,
          env: server.env,
        },
      },
    },
    null,
    2,
  );
}

/** The runtime CLI started directly needs its `mcp` subcommand. */
export function runtimeMcpLaunch(cli: McpLaunch): McpLaunch {
  return { ...cli, args: [...cli.args, "mcp"] };
}
