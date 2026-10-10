import { z } from "zod";

const text = z.string().trim().min(1).max(12000);
const texts = z.array(text).min(1).max(100);
export const REUSE_KINDS = ["general", "domain", "content-specific"] as const;
export const reuseLabels = {
  general: "通用",
  domain: "专题",
  "content-specific": "内容专用",
  unclassified: "待评估",
} as const;
export const componentDocumentationSchema = z
  .object({
    version: z.literal(1),
    reuse: z
      .object({
        kind: z.enum(REUSE_KINDS),
        boundaries: texts,
        owner: text.optional(),
      })
      .strict(),
    usage: z
      .object({
        purpose: text,
        structure: texts,
        inputs: z
          .array(z.object({ path: text, meaning: text }).strict())
          .min(1)
          .max(200),
        recipes: z
          .array(
            z
              .object({
                title: text,
                steps: texts,
                exampleIndex: z.number().int().nonnegative().optional(),
              })
              .strict(),
          )
          .min(1)
          .max(30),
        interactions: z
          .array(
            z
              .object({
                action: text,
                effect: text,
                persistence: z.enum(["view", "content", "mixed", "none"]),
              })
              .strict(),
          )
          .min(1)
          .max(50),
        constraints: texts,
        editing: z.object({ data: texts, implementation: texts }).strict(),
      })
      .strict(),
    development: z
      .object({
        entryPoints: z
          .array(z.object({ path: text, purpose: text }).strict())
          .min(1)
          .max(100),
        architecture: texts,
        extensionPoints: texts,
        invariants: texts,
        verification: texts,
      })
      .strict(),
  })
  .strict();
export type ComponentDocumentation = z.infer<
  typeof componentDocumentationSchema
>;
export type ReuseKind = ComponentDocumentation["reuse"]["kind"];

export function validateComponentDocumentation(
  value: unknown,
  examples?: number,
): ComponentDocumentation {
  const documentation = componentDocumentationSchema.parse(value);
  for (const recipe of documentation.usage.recipes) {
    if (
      recipe.exampleIndex !== undefined &&
      examples !== undefined &&
      recipe.exampleIndex >= examples
    )
      throw new Error(
        `Documentation recipe '${recipe.title}' references a missing example.`,
      );
  }
  if (
    documentation.reuse.kind === "content-specific" &&
    !documentation.reuse.owner
  )
    throw new Error(
      "Content-specific components must identify their owning work or purpose.",
    );
  return documentation;
}

export function documentationStatus(value: {
  documentation?: ComponentDocumentation;
}) {
  return value.documentation ? ("available" as const) : ("missing" as const);
}
