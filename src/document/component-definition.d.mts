export interface ComponentEntity {
  name: string;
  path: string;
  id: string;
  scope?: string;
  scopeValue?: string;
  optional?: boolean;
}
export interface ComponentEvent {
  name: string;
  entity?: string;
  intent: "notification" | "request";
  payload?: Record<string, unknown> | boolean;
}
export interface ComponentAction {
  name: string;
  effect: "view" | "content";
  input?: Record<string, unknown> | boolean;
  output?: Record<string, unknown> | boolean;
}
export interface ComponentSlot {
  name: string;
  path: string;
  format: "richtext";
  fallbackFor?: string;
  accepts?: string[];
}
export interface ComponentContract {
  version: 1;
  requires?: Record<string, number>;
  entities?: ComponentEntity[];
  events?: ComponentEvent[];
  actions?: ComponentAction[];
  slots?: ComponentSlot[];
  references?: { path: string; slot: string; scope?: string }[];
  view?: { version: number; schema: Record<string, unknown> | boolean };
}
export interface ComponentObject {
  type: string;
  scope: string;
  id: string;
}
export interface ComponentContractMetadata {
  insertion?: { nodeType: string; surfaceKind?: string };
  kind?: string;
  inline?: { protocol?: number };
  contract?: ComponentContract;
  role?: string;
  pageOutlineProtocol?: number;
  reader?: string;
  pageReferences?: boolean;
  contributes?: {
    databaseField?: unknown;
    mention?: unknown;
    commands?: unknown;
  };
}
export const COMPONENT_PROTOCOL: "showai-component-v1";
export const COMPONENT_CONTRACT_SCHEMA: Record<string, unknown>;
export const COMPONENT_CAPABILITIES: Readonly<Record<string, number>>;
export function validateComponentContract(value: unknown): ComponentContract;
export function contractPath(value: string): string[];
export function contractValues(
  data: unknown,
  pointer: string,
  context?: string[],
): { value: any; path: string[] }[];
export function componentObjects(
  contract: ComponentContract,
  data: unknown,
): ComponentObject[];
export function validateComponentContractData(
  contract: ComponentContract,
  data: unknown,
): unknown;
export function componentContract(metadata: ComponentContractMetadata): {
  protocol: typeof COMPONENT_PROTOCOL;
  status: "declared" | "adapted" | "legacy";
  contract: ComponentContract;
  capabilities: Record<string, number>;
  legacy: boolean;
  execution: { mode: string; inlineProtocol: number | "legacy" };
};

export function componentSlotValues(
  contract: ComponentContract,
  data: unknown,
  slot: ComponentSlot,
): { value: any; path: string[] }[];
