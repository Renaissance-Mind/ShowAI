import { z } from "zod";
import type { AgentService } from "../service";

export type Access = "read" | "write";

export interface OperationContext {
  service: AgentService;
  projectId: string;
}

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

export function pick<
  Shape extends z.ZodRawShape,
  const Key extends keyof Shape,
>(
  shape: Shape,
  keys: readonly Key[],
): Pick<Shape, Key> {
  return Object.fromEntries(keys.map((key) => [key, shape[key]])) as Pick<
    Shape,
    Key
  >;
}

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
