import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const BlockActionHost = createContext<{
  target: HTMLElement | null;
  selected: boolean;
  closeSettings?: () => void;
} | null>(null);

export interface BlockItemSource {
  label?: string;
  readOnly: readonly string[];
  removable: boolean;
}
export const BlockItemSources = createContext<ReadonlyMap<
  string,
  BlockItemSource
> | null>(null);

export interface BlockDataStateValue {
  status: "ok" | "stale" | "empty";
  editable: boolean | { paths: string[] };
  dataset?: string;
}
export const BlockDataState = createContext<BlockDataStateValue | null>(null);

export function BlockActions({ children }: { children: ReactNode }) {
  const host = useContext(BlockActionHost);
  if (!host) return children;
  return host.selected && host.target
    ? createPortal(children, host.target)
    : null;
}

export function BlockSettings({ children }: { children: ReactNode }) {
  const host = useContext(BlockActionHost);
  if (!host) return children;
  return host.target
    ? createPortal(
        <div
          className="board-component-settings"
          data-surface-ui
          hidden={!host.selected}
          onKeyDown={(event) => {
            if (event.key === "Escape" && host.closeSettings) {
              event.preventDefault();
              event.stopPropagation();
              host.closeSettings();
              host.target
                ?.querySelector<HTMLButtonElement>(
                  ".sb-actions > button.sb-icon-button.is-active:last-child",
                )
                ?.focus({ preventScroll: true });
            }
          }}
        >
          {children}
        </div>,
        host.target,
      )
    : null;
}
