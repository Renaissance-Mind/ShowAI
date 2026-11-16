import { useEffect, useLayoutEffect, useRef } from "react";

interface Scope {
  open(): void;
  close(): Promise<void>;
}

export function useScopeLifecycle(scope: Scope, failure: string) {
  const generation = useRef(0);
  const current = useRef(scope);
  current.current = scope;
  useLayoutEffect(() => {
    generation.current++;
    scope.open();
  }, [scope]);
  useEffect(() => {
    const mounted = generation.current;
    return () => {
      queueMicrotask(() => {
        if (current.current !== scope || generation.current === mounted)
          void scope.close().catch((error) => console.error(failure, error));
      });
    };
  }, [scope, failure]);
}
