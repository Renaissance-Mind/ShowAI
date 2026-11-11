import { z } from "zod";
import { parsePageLink } from "../../portable/page-link.mjs";

/**
 * Commands a library component contributes to the workbench's quick jump.
 * They are part of the manifest, so they are saved, versioned and verified
 * with the package; the workbench and the Agent read them from the catalog.
 *
 * run.insert puts the component into the open page with the props of one of
 * its examples or with props of its own (checked against the schema when the
 * package is compiled). run.goTo is the same navigation the component's goTo
 * performs, with an absolute page link because a command has no page around it.
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
export const componentCommandsSchema = z
  .array(componentCommandSchema)
  .max(COMPONENT_COMMAND_LIMIT);
export type ComponentCommand = z.infer<typeof componentCommandSchema>;

/** Structure and references inside the manifest; props are checked against the schema on compile. */
export function validateComponentCommands(
  value: unknown,
  examples: number,
): ComponentCommand[] {
  const result = componentCommandsSchema.safeParse(value);
  if (!result.success)
    throw new Error(
      "Component commands: " +
        result.error.issues
          .map((issue) => `${issue.path.join(".") || "commands"} ${issue.message}`)
          .join("; "),
    );
  const commands = result.data;
  const ids = new Set<string>();
  for (const command of commands) {
    if (ids.has(command.id))
      throw new Error(`Component command ids must be unique: ${command.id}.`);
    ids.add(command.id);
    if (
      "insert" in command.run &&
      command.run.insert.example !== undefined &&
      command.run.insert.example >= examples
    )
      throw new Error(
        `Component command '${command.id}' references a missing example.`,
      );
  }
  return commands;
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
