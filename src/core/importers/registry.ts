import { CoreError } from "../model";
import { contributedImporter, listContributedImporters } from "./contributed";
import { wordImporter } from "./docx";
import { markdownImporter } from "./markdown";
import { notionImporter } from "./notion";
import type { ImportInput, Importer, ImporterInfo } from "./types";

export const BUILTIN_IMPORTERS: Importer[] = [
  notionImporter,
  wordImporter,
  markdownImporter,
];

export async function availableImporters(
  home: string,
  projectId?: string,
): Promise<{ importers: Importer[]; problems: string[] }> {
  const contributed = await listContributedImporters(home, projectId);
  return {
    importers: [
      ...contributed.importers.map(contributedImporter),
      ...BUILTIN_IMPORTERS,
    ],
    problems: contributed.problems,
  };
}

export const importerInfo = (importer: Importer): ImporterInfo => ({
  id: importer.id,
  name: importer.name,
  description: importer.description,
  extensions: importer.extensions,
  folders: importer.folders,
  origin: importer.origin,
});

export async function chooseImporter(
  input: ImportInput,
  importers: Importer[],
  id?: string,
): Promise<{
  importer: Importer;
  candidates: { id: string; name: string; score: number }[];
}> {
  const candidates: { id: string; name: string; score: number }[] = [];
  for (const importer of importers)
    candidates.push({
      id: importer.id,
      name: importer.name,
      score: await importer.detect(input),
    });
  if (id) {
    const importer = importers.find((item) => item.id === id);
    if (!importer)
      throw new CoreError(
        "NOT_FOUND",
        `No importer ${id}. Available: ${importers.map((item) => item.id).join(", ")}.`,
      );
    return { importer, candidates };
  }
  let best: Importer | undefined;
  let score = 0;
  importers.forEach((importer, index) => {
    if (candidates[index].score > score) {
      best = importer;
      score = candidates[index].score;
    }
  });
  if (!best)
    throw new CoreError(
      "INVALID_DATA",
      `No importer reads ${input.name}. Importers: ${importers
        .map(
          (item) =>
            `${item.id} (${[...item.extensions, ...(item.folders ? ["folders"] : [])].join(", ")})`,
        )
        .join("; ")}.`,
    );
  return { importer: best, candidates };
}
