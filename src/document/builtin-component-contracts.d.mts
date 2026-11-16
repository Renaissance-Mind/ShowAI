import type { ComponentContract } from "./component-definition.mjs";
export const builtinContracts: Record<string, ComponentContract>;
export const legacyChildKindPaths: Record<string, string[]>;

export function builtinComponentContract(kind: string): ComponentContract;
