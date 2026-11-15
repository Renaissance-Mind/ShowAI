import { createContext, type ComponentType, type ReactNode } from "react";
import type { BlockProps } from "../components/blocks/types";

export const BoundWidgetHost = createContext<{
  Bound: ComponentType<
    BlockProps & {
      kind: string;
      render: (props: BlockProps & { kind: string }) => ReactNode;
    }
  >;
  Action: ComponentType<BlockProps & { kind: string }>;
} | null>(null);

export function hasBinding(data: unknown): boolean {
  const binding =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>).$binding
      : undefined;
  return !!binding && typeof binding === "object" && !Array.isArray(binding);
}
