interface UniversalPluginOptions {
  name?: string;
  displayName?: string;
  appId?: string;
  setupUrl?: string;
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
