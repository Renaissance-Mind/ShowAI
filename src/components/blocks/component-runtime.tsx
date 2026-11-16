import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { ComponentRuntime } from "../../contract/component-runtime.mjs";
import type { BlockProps } from "./types";

type Renderer = (props: BlockProps & { kind: string }) => ReactNode;
const Context = createContext<{
  runtime: ComponentRuntime;
  renderWidget?: Renderer;
} | null>(null);
export function ComponentRuntimeProvider({
  runtime,
  renderWidget,
  children,
}: {
  runtime: ComponentRuntime;
  renderWidget?: Renderer;
  children: ReactNode;
}) {
  return (
    <Context.Provider value={{ runtime, renderWidget }}>
      {children}
    </Context.Provider>
  );
}
export function useComponentRuntime() {
  const context = useContext(Context);
  if (!context)
    throw new Error(
      "No component runtime is available. Use a declared component host.",
    );
  return context.runtime;
}
export function useComponentAction(
  name: string,
  handler: (input: unknown) => unknown,
) {
  const runtime = useComponentRuntime();
  useEffect(
    () => runtime.actions.register(name, handler),
    [runtime, name, handler],
  );
}
export function useComponentRuntimeContext() {
  return useContext(Context);
}
