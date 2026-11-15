export { htmlArtifactSource } from "../core/importers/html-artifact";

export const IMPORT_DROP_LIMIT = 256 * 1024 * 1024;

export function acceptsImport(name: string, extensions: readonly string[]) {
  const extension = /\.[^./\\]+$/.exec(name)?.[0]?.toLowerCase();
  return !!extension && extensions.includes(extension);
}
