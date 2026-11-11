import type { ShowArtifact } from "../../types";

// The importer slot of the harness. An importer reads an input (one file, a
// folder or a zip) and returns an ImportBundle: folders, pages made of
// catalog component instances ({kind, data}, exactly what page_create
// blocks and component.insert accept) and datasets. It knows nothing about
// storage; the harness plans, confirms and writes the bundle through the
// normal page and dataset save paths. Built-in importers (Notion, Word,
// Markdown) and importers contributed from the content library fill the
// same slot with the same bundle.
//
// References between the parts of a bundle, and to files of the input, are
// placeholders in any string of block data or dataset values; the harness
// replaces them before validating and saving:
//   showai-import:page/KEY      → showai://project/P/page/ID of a bundle page
//   showai-import:folder/KEY    → the id of a bundle folder
//   showai-import:dataset/KEY   → the id of a bundle dataset
//   showai-import:file/PATH     → the input file embedded as a data URL
// KEY and PATH are encoded with encodeURIComponent (PATH per segment or whole).

export interface ImportFile {
  /** Path inside the input, "/"-separated, without a leading slash. */
  path: string;
  size: number;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
}

export interface ImportInput {
  /** File or folder name the person chose. */
  name: string;
  /** "files": several files chosen or dropped together. */
  kind: "file" | "files" | "folder" | "zip";
  files: ImportFile[];
  /** Problems met while reading the input (e.g. a damaged nested zip). */
  problems: ImportWarning[];
}

export interface ImportWarning {
  /** Input path the warning is about. */
  source?: string;
  message: string;
}

export interface ImportBlock {
  kind: string;
  data: Record<string, unknown>;
}

export interface ImportBundle {
  /** Name of the folder that holds a bundle with more than one top item. */
  title?: string;
  folders?: { key: string; title: string; parent?: string; source?: string }[];
  pages: {
    key: string;
    title: string;
    parent?: string;
    source?: string;
    /** Catalog component instances in reading order, as page_create blocks. */
    blocks?: ImportBlock[];
    /** Or a whole ShowAI page source, as page_create document/components. */
    artifact?: ShowArtifact;
  }[];
  datasets?: {
    key: string;
    name: string;
    value: unknown;
    description?: string;
  }[];
  warnings?: ImportWarning[];
}

export interface ImporterInfo {
  id: string;
  name: string;
  description: string;
  /** Lower-case extensions with the dot, offered by the file dialog. */
  extensions: string[];
  /** Whether the importer also reads a folder or a zip of files. */
  folders: boolean;
  origin: "builtin" | "global" | "project";
}

export interface Importer extends ImporterInfo {
  /** 0 (cannot read) … 1 (certain). */
  detect(input: ImportInput): Promise<number>;
  convert(input: ImportInput): Promise<ImportBundle>;
}

export const IMPORT_PLACEHOLDER =
  /showai-import:(page|folder|dataset|file)\/([^\s)"'<>\]]+)/g;

/** A placeholder an importer writes into block data or a dataset value. */
export function importRef(
  kind: "page" | "folder" | "dataset" | "file",
  key: string,
): string {
  return `showai-import:${kind}/${encodeURIComponent(key)}`;
}
