import { createContext, useContext, useMemo, type ReactNode } from "react";

/** Stable component-owned identities. Scope distinguishes repeated item IDs. */
export interface ComponentTarget {
  type: string;
  scope: string;
  id: string;
}
export interface ComponentActivationProps {
  activationTargets?: readonly ComponentTarget[];
  onActivate?: (target: ComponentTarget) => boolean;
}

export function sameComponentTarget(a: ComponentTarget, b: ComponentTarget) {
  return a.type === b.type && a.scope === b.scope && a.id === b.id;
}

interface InteractionScope {
  targets: readonly ComponentTarget[];
  canActivate: (target: ComponentTarget) => boolean;
  activate: (target: ComponentTarget) => boolean;
}

const inactive: InteractionScope = {
  targets: [],
  canActivate: () => false,
  activate: () => false,
};
const Context = createContext<InteractionScope>(inactive);

/** Bind reading actions without changing the child component's saved data. */
export function ComponentInteractions({
  targets,
  onActivate,
  children,
}: {
  targets: readonly ComponentTarget[];
  onActivate: (target: ComponentTarget) => void;
  children: ReactNode;
}) {
  const value = useMemo<InteractionScope>(() => {
    const canActivate = (target: ComponentTarget) =>
      targets.some((bound) => sameComponentTarget(bound, target));
    return {
      targets,
      canActivate,
      activate(target) {
        if (!canActivate(target)) return false;
        onActivate(target);
        return true;
      },
    };
  }, [targets, onActivate]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Return true from activate only when the surrounding container handled it. */
export function useComponentInteractions() {
  return useContext(Context);
}
