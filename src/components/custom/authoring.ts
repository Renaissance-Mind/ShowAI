import { z } from "zod";

const file = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      value.split("/").every((part) => part && part !== "." && part !== ".."),
    "制作文件必须位于组件源码包内。",
  );
const guideReference = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    file,
    appliesTo: z.array(z.string()).optional(),
    sourcePath: file.optional(),
    url: z.url({ protocol: /^https?$/ }).optional(),
    sha256: z.string().regex(/^[a-f\d]{64}$/),
  })
  .strict();
export const componentAuthoringIndexSchema = z
  .object({
    format: z.literal("showai-component-authoring"),
    version: z.literal(1),
    family: z.string().min(1).optional(),
    repository: z.url({ protocol: /^https?$/ }).optional(),
    commit: z
      .string()
      .regex(/^[a-f\d]{40}$/)
      .optional(),
    guides: z.array(guideReference).min(1).max(150),
    kit: file.optional(),
    runner: file.optional(),
    commands: z
      .array(z.object({ type: z.string(), command: z.string() }).strict())
      .optional(),
    rules: z.array(z.string()).optional(),
    schemas: file.optional(),
    examples: file.optional(),
  })
  .strict();
export const componentAuthoringGuideSchema = guideReference
  .extend({
    format: z.literal("showai-authoring-guide"),
    version: z.literal(1),
    repository: z.url({ protocol: /^https?$/ }).optional(),
    commit: z
      .string()
      .regex(/^[a-f\d]{40}$/)
      .optional(),
    markdown: z.string().min(1),
  })
  .strict();
export type ComponentAuthoringIndex = z.infer<
  typeof componentAuthoringIndexSchema
>;
export function componentAuthoringIndex(
  files: Record<string, string>,
  entry: string,
) {
  file.parse(entry);
  if (!files[entry]) throw new Error(`缺少制作索引：${entry}`);
  const index = componentAuthoringIndexSchema.parse(JSON.parse(files[entry]));
  for (const path of [
    index.kit,
    index.runner,
    index.schemas,
    index.examples,
    ...index.guides.map((guide) => guide.file),
  ].filter((value): value is string => !!value))
    if (!files[path]) throw new Error(`缺少制作文件：${path}`);
  if (
    new Set(index.guides.map((guide) => guide.id)).size !== index.guides.length
  )
    throw new Error("制作指南 ID 重复。");
  return index;
}
export function componentAuthoringGuide(
  files: Record<string, string>,
  index: ComponentAuthoringIndex,
  id: string,
) {
  const ref = index.guides.find((guide) => guide.id === id);
  if (!ref) throw new Error("找不到制作指南。");
  const guide = componentAuthoringGuideSchema.parse(
    JSON.parse(files[ref.file]),
  );
  if (
    guide.sha256 !== ref.sha256 ||
    guide.sourcePath !== ref.sourcePath ||
    guide.file !== ref.file ||
    guide.id !== ref.id ||
    guide.commit !== index.commit ||
    guide.repository !== index.repository ||
    guide.url !== ref.url ||
    guide.title !== ref.title ||
    JSON.stringify(guide.appliesTo) !== JSON.stringify(ref.appliesTo)
  )
    throw new Error("制作指南与来源索引不一致。");
  return guide;
}
