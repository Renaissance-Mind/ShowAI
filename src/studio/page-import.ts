export { htmlArtifactSource } from "../core/importers/html-artifact";

/** Largest set of files a drop hands to the import; bigger exports go through Import… with their path. */
export const IMPORT_DROP_LIMIT = 256 * 1024 * 1024;

/** Whether a file name has one of the importers' extensions (".zip", ".docx", …). */
export function acceptsImport(name: string, extensions: readonly string[]) {
  const extension = /\.[^./\\]+$/.exec(name)?.[0]?.toLowerCase();
  return !!extension && extensions.includes(extension);
}
