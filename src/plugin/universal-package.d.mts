interface UniversalPluginOptions {
  name?: string;
  displayName?: string;
  appId?: string;
  appAlias?: string;
  setupUrl?: string;
  mcp?: string;
  mcpAuth?: "oauth" | "none";
  runtimeConfig?: string;
  host?: "cursor" | "qoder" | "workbuddy" | "kimi-code";
}
export function universalPluginFiles(
  source: string,
  options?: UniversalPluginOptions,
): Promise<{
  name: string;
  version: string;
  files: Map<string, Buffer>;
}>;
export function universalPluginArchive(
  source: string,
  options?: UniversalPluginOptions,
): Promise<{
  name: string;
  version: string;
  files: string[];
  bytes: Buffer;
}>;
