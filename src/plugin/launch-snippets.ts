export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export type LaunchSnippetKind = "claude" | "codex" | "json" | "opencode";

export type T3CodeProvider = LaunchSnippetKind | "claude-legacy";

export function t3CodeLaunchSnippet(provider: T3CodeProvider, launch: McpLaunch, platform?: string) {
  return launchSnippet(provider === "claude-legacy" ? "claude" : provider, {
    ...launch,
    env: {
      ...launch.env,
      SHOWAI_LINKED_WORKBENCH: "1",
      SHOWAI_CARD_DESTINATION: "desktop",
      SHOWAI_HOST_DISPLAY: provider === "codex" || provider === "claude" ? "mcp-app" : "t3-html",
    },
  }, platform);
}

function shellQuote(value: string, platform?: string) {
  if (platform === "win32")
    return /^[\w./:\\-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
  return /^[\w./:=@%+-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

const toml = (value: string) => JSON.stringify(value);

export function launchSnippet(
  kind: LaunchSnippetKind,
  server: McpLaunch,
  platform?: string,
) {
  const env = Object.entries(server.env);
  if (kind === "claude")
    return [
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
  if (kind === "opencode")
    return JSON.stringify(
      {
        mcp: {
          showai: {
            type: "local",
            command: [server.command, ...server.args],
            environment: server.env,
          },
        },
      },
      null,
      2,
    );
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

export function runtimeMcpLaunch(cli: McpLaunch): McpLaunch {
  return { ...cli, args: [...cli.args, "mcp"] };
}
