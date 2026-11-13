import { z } from "zod";
import type { AgentService } from "../service";

export type Access = "read" | "write";

/** What an operation needs besides its input, the same for every entry. */
export interface OperationContext {
  service: AgentService;
  /** The project, already resolved and authorized by the entry. */
  projectId: string;
}

/**
 * One capability that the CLI and MCP share: its input contract and what it
 * does. run returns the result before an entry shapes it (receipts, links).
 */
export interface Operation<Shape extends z.ZodRawShape = z.ZodRawShape> {
  id: string;
  access: Access;
  input: Shape;
  run(
    context: OperationContext,
    input: z.infer<z.ZodObject<Shape>>,
  ): Promise<unknown>;
}

export const operation = <Shape extends z.ZodRawShape>(
  declaration: Operation<Shape>,
) => declaration;

/** Fields of an operation's input in the given order, e.g. for a tool schema. */
export function pick<Shape extends z.ZodRawShape, Key extends keyof Shape>(
  shape: Shape,
  keys: readonly Key[],
): Pick<Shape, Key> {
  return Object.fromEntries(keys.map((key) => [key, shape[key]])) as Pick<
    Shape,
    Key
  >;
}

/**
 * Validates input from an entry that did not validate it yet (the CLI).
 * Errors name the entry's own spelling of each field, e.g. --base-hash.
 */
export function parseInput<Shape extends z.ZodRawShape>(
  declaration: Operation<Shape>,
  input: Record<string, unknown>,
  names: Partial<Record<keyof Shape, string>> = {},
): z.infer<z.ZodObject<Shape>> {
  const parsed = z.object(declaration.input).strict().safeParse(input);
  if (parsed.success) return parsed.data;
  throw new Error(
    parsed.error.issues
      .map((issue) => {
        const [field, ...rest] = issue.path.map(String);
        const name =
          field === undefined
            ? "input"
            : (names[field as keyof Shape] ?? field) +
              rest.map((part) => `.${part}`).join("");
        return issue.code === "unrecognized_keys"
          ? `${name}: unknown fields ${issue.keys.join(", ")}`
          : `${name}: ${issue.message}`;
      })
      .join("; "),
  );
}
