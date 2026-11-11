import { z } from "zod";
import { parsePageLink } from "../../portable/page-link.mjs";
import { KIND_OPERATORS, VALUE_KINDS } from "../../datasets/value-types.mjs";
import type {
  FilterOperator,
  ValueKind,
} from "../../datasets/value-types.mjs";

/**
 * What a component contributes to the slots the workbench offers, declared in
 * `manifest.contributes` (library packages) or `contributes` (built-in
 * metadata). Every slot a component fills is validated here, with one error
 * style: `contributes.<path> <problem>`.
 *
 * - commands: entries in quick jump (Cmd/Ctrl+K) that insert the component or
 *   open a page.
 * - mention: the component is offered in the @ menu of rich text and placed
 *   inside the line, the menu filling one string prop.
 * - databaseField: the component is a database field type; the harness half
 *   (value kind, operators) is declared here, the cell half is its `field`
 *   export and default React export.
 */

export const COMPONENT_COMMAND_LIMIT = 20;
const commandId = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,63}$/, "must be lowercase letters, digits and -");
const label = z.string().trim().min(1).max(120);
const pageLink = z
  .string()
  .max(8192)
  .refine((value) => parsePageLink(value) !== null, {
    message: "must be a page link showai://project/PROJECT/page/PAGE[?blocks=ID]",
  });

export const componentCommandSchema = z
  .object({
    id: commandId,
    title: label,
    keywords: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    run: z.union([
      z
        .object({
          insert: z
            .object({
              example: z.number().int().nonnegative().optional(),
              props: z.record(z.string(), z.json()).optional(),
            })
            .strict()
            .refine(
              (value) =>
                value.example === undefined || value.props === undefined,
              { message: "give example or props, not both" },
            ),
        })
        .strict(),
      z.object({ goTo: pageLink }).strict(),
    ]),
  })
  .strict();
export type ComponentCommand = z.infer<typeof componentCommandSchema>;

export const MENTION_INPUTS = ["date", "text", "options"] as const;
const mentionSchema = z
  .object({
    prop: z
      .string()
      .regex(/^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/, "must name a top-level prop"),
    input: z.enum(MENTION_INPUTS),
    options: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(200),
            value: z.string().max(1000),
            keywords: z.string().max(500).optional(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict()
  .refine((value) => value.input !== "options" || !!value.options?.length, {
    message: 'with input "options" needs options',
  });
export type MentionContract = z.infer<typeof mentionSchema>;
export type MentionOption = NonNullable<MentionContract["options"]>[number];

const databaseFieldSchema = z
  .object({
    protocol: z.literal(1),
    valueKind: z.enum(VALUE_KINDS as [ValueKind, ...ValueKind[]]),
    operators: z.array(z.string()).min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const allowed: readonly string[] = KIND_OPERATORS[value.valueKind];
    for (const [index, operator] of (value.operators ?? []).entries())
      if (!allowed.includes(operator))
        context.addIssue({
          code: "custom",
          path: ["operators", index],
          message: `must be an operator of ${value.valueKind} values: ${allowed.join(", ")}`,
        });
  });
export interface DatabaseFieldContribution {
  protocol: 1;
  valueKind: ValueKind;
  operators?: FilterOperator[];
}

export const contributionsSchema = z
  .object({
    commands: z
      .array(componentCommandSchema)
      .max(COMPONENT_COMMAND_LIMIT)
      .optional(),
    mention: mentionSchema.optional(),
    databaseField: databaseFieldSchema.optional(),
  })
  .strict();
export interface ComponentContributions {
  commands?: ComponentCommand[];
  mention?: MentionContract;
  databaseField?: DatabaseFieldContribution;
}

/** The slots a component can fill, for listings and guides. */
export const CONTRIBUTION_SLOTS = ["commands", "mention", "databaseField"] as const;

const fail = (message: string): never => {
  throw new Error(`contributes${message}`);
};
const at = (path: PropertyKey[]) =>
  path
    .map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`))
    .join("");

/**
 * The checked declaration. `examples` is the number of examples, for
 * commands that insert one; `schema` (the props schema) is given when the
 * package is compiled and checks the prop a mention fills.
 */
export function validateContributions(
  value: unknown,
  { examples, schema }: { examples: number; schema?: unknown },
): ComponentContributions {
  const result = contributionsSchema.safeParse(value);
  if (!result.success)
    fail(
      result.error.issues
        .map((issue) => `${at(issue.path)} ${issue.message}`)
        .join("; "),
    );
  const contributions = result.data! as ComponentContributions;
  const ids = new Set<string>();
  contributions.commands?.forEach((command, index) => {
    if (ids.has(command.id))
      fail(`.commands[${index}].id must be unique: ${command.id}`);
    ids.add(command.id);
    if (
      "insert" in command.run &&
      command.run.insert.example !== undefined &&
      command.run.insert.example >= examples
    )
      fail(`.commands[${index}].run.insert.example names a missing example`);
  });
  if (contributions.mention && contributions.databaseField)
    fail(
      " cannot hold both mention and databaseField: a field type's props are its column settings",
    );
  if (contributions.mention && schema !== undefined) {
    const field = (
      schema as { properties?: Record<string, { type?: unknown }> }
    )?.properties?.[contributions.mention.prop];
    const type = field?.type;
    if (
      !field ||
      !(type === "string" || (Array.isArray(type) && type.includes("string")))
    )
      fail(".mention.prop must be a string property of the props schema");
  }
  if (!contributions.commands?.length) delete contributions.commands;
  return contributions;
}

/** The props an insert command puts into the page. */
export function commandProps(
  command: ComponentCommand,
  component: {
    defaultData: Record<string, unknown>;
    examples: { data: Record<string, unknown> }[];
  },
): Record<string, unknown> {
  if (!("insert" in command.run))
    throw new Error(`Command '${command.id}' does not insert the component.`);
  const { example, props } = command.run.insert;
  if (props) return props as Record<string, unknown>;
  if (example !== undefined) {
    const data = component.examples[example]?.data;
    if (!data)
      throw new Error(`Command '${command.id}' references a missing example.`);
    return data;
  }
  return component.defaultData;
}
