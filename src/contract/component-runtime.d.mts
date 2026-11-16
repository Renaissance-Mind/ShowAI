import type {
  ComponentContract,
  ComponentObject,
} from "./component-contract.mjs";
export type ComponentReceipt<T = unknown> =
  | { status: "handled"; value?: T }
  | { status: "unhandled" | "unavailable" | "failed"; reason?: string };
export type ComponentSlotContext =
  | { kind: "block" | "inline" }
  | {
      kind: "pageOutline";
      context: import("../document/page-outline.mjs").PageOutlineData;
    }
  | {
      kind: "databaseField";
      context: {
        editable: boolean;
        value: unknown;
        column: {
          id: string;
          name?: string;
          type: string;
          config?: Record<string, unknown>;
        };
      };
    };
export interface ComponentRuntime {
  protocol: "showai-component-v1";
  contract: ComponentContract;
  capabilities: Record<string, number>;
  data: Record<string, unknown>;
  slot: ComponentSlotContext;
  readOnly: boolean;
  dataState: ReturnType<
    typeof import("../lib/component-editability.mjs").componentDataState
  >;
  objects(): ComponentObject[];
  update(data: Record<string, unknown>): Promise<ComponentReceipt>;
  events: {
    emit(
      name: string,
      target?: ComponentObject | null,
      payload?: unknown,
    ): Promise<ComponentReceipt>;
  };
  actions: {
    register(name: string, handler: (input: any) => unknown): () => void;
    invoke(name: string, input?: unknown): Promise<ComponentReceipt>;
  };
  view: {
    readonly value: unknown;
    set(value: unknown): Promise<ComponentReceipt>;
  };
  navigation: { open(target: unknown): Promise<ComponentReceipt> };
  conversation: { submit(snapshot: unknown): Promise<ComponentReceipt> };
  field: {
    set(value: unknown): Promise<ComponentReceipt>;
    close(): Promise<ComponentReceipt>;
  };
  outline: {
    navigate(id: string): Promise<ComponentReceipt>;
    expand(id: string, expanded: boolean): Promise<ComponentReceipt>;
    collapse(): Promise<ComponentReceipt>;
  };
  dispose(): void;
}
export function createComponentRuntime(options: {
  contract?: ComponentContract;
  state(): {
    data: Record<string, unknown>;
    readOnly?: boolean;
    dataState?: unknown;
    view?: unknown;
    slot?: ComponentSlotContext;
  };
  capabilities?(): Record<string, number>;
  validate?(kind: string, name: string, value: unknown): string | undefined;
  request?(
    operation: string,
    input: any,
  ): Promise<ComponentReceipt> | ComponentReceipt;
}): ComponentRuntime;
