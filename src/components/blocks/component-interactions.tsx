import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ComponentReceipt } from "../../contract/component-runtime.mjs";

export interface ComponentTarget {
  type: string;
  scope: string;
  id: string;
}
export interface ComponentActivationProps {
  activationTargets?: readonly ComponentTarget[];
  onActivate?: (target: ComponentTarget) => boolean;
}
export interface ComponentEventBinding {
  event: string;
  target: ComponentTarget;
  handle: (payload: unknown) => ComponentReceipt | Promise<ComponentReceipt>;
}
export function sameComponentTarget(a: ComponentTarget, b: ComponentTarget) {
  return a.type === b.type && a.scope === b.scope && a.id === b.id;
}
interface InteractionScope {
  targets: readonly ComponentTarget[];
  canActivate: (target: ComponentTarget) => boolean;
  activate: (target: ComponentTarget) => boolean;
  emit: (
    name: string,
    target: ComponentTarget,
    payload?: unknown,
  ) => Promise<ComponentReceipt>;
}
const inactive: InteractionScope = {
  targets: [],
  canActivate: () => false,
  activate: () => false,
  emit: async () => ({ status: "unhandled" }),
};
const Context = createContext<InteractionScope>(inactive);
export function ComponentEventBoundary({
  bindings,
  children,
}: {
  bindings: readonly ComponentEventBinding[];
  children: ReactNode;
}) {
  const value = useMemo<InteractionScope>(() => {
    const identities = new Set<string>();
    for (const binding of bindings) {
      const identity = JSON.stringify([
        binding.event,
        binding.target.type,
        binding.target.scope,
        binding.target.id,
      ]);
      if (identities.has(identity))
        throw new Error("Duplicate component event binding");
      identities.add(identity);
    }
    const find = (event: string, target: ComponentTarget) =>
      bindings.find(
        (binding) =>
          binding.event === event &&
          sameComponentTarget(binding.target, target),
      );
    return {
      targets: bindings
        .filter((binding) => binding.event === "activate")
        .map((binding) => binding.target),
      canActivate: (target) => !!find("activate", target),
      activate(target) {
        const binding = find("activate", target);
        if (!binding) return false;
        void binding.handle(null);
        return true;
      },
      async emit(event, target, payload = null) {
        const binding = find(event, target);
        return binding ? binding.handle(payload) : { status: "unhandled" };
      },
    };
  }, [bindings]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function ComponentInteractions({
  targets,
  onActivate,
  children,
}: {
  targets: readonly ComponentTarget[];
  onActivate: (target: ComponentTarget) => void;
  children: ReactNode;
}) {
  const bindings = useMemo<ComponentEventBinding[]>(
    () =>
      targets
        .filter(
          (target, index) =>
            targets.findIndex((item) => sameComponentTarget(item, target)) ===
            index,
        )
        .map((target) => ({
          event: "activate",
          target,
          handle: () => {
            onActivate(target);
            return { status: "handled" };
          },
        })),
    [targets, onActivate],
  );
  return (
    <ComponentEventBoundary bindings={bindings}>
      {children}
    </ComponentEventBoundary>
  );
}
export function useComponentEvents() {
  return useContext(Context);
}
export const useComponentInteractions = useComponentEvents;
