import { createContext } from "react";

export const BindingBasisContext = createContext<
  ((props: Record<string, unknown>) => void) | null
>(null);
