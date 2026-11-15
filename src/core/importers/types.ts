import type { ShowArtifact } from "../../types";


export interface ImportFile {
  path: string;
  size: number;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
}

export interface ImportInput {
  name: string;
  kind: "file" | "files" | "folder" | "zip";
  files: ImportFile[];
  problems: ImportWarning[];
}

export interface ImportWarning {
  source?: string;
  message: string;
}

export interface ImportBlock {
  kind: string;
  data: Record<string, unknown>;
}

export interface ImportBundle {
  title?: string;
  folders?: { key: string; title: string; parent?: string; source?: string }[];
  pages: {
    key: string;
    title: string;
    parent?: string;
    source?: string;
    blocks?: ImportBlock[];
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
  extensions: string[];
  folders: boolean;
  origin: "builtin" | "global" | "project";
}

export interface Importer extends ImporterInfo {
  detect(input: ImportInput): Promise<number>;
  convert(input: ImportInput): Promise<ImportBundle>;
}

export const IMPORT_PLACEHOLDER =
  /showai-import:(page|folder|dataset|file)\/([^\s)"'<>\]]+)/g;

export function importRef(
  kind: "page" | "folder" | "dataset" | "file",
  key: string,
): string {
  return `showai-import:${kind}/${encodeURIComponent(key)}`;
}
