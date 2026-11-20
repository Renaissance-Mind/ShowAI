import { createContext, useContext } from "react";
import type { ToastOptions } from "./queue";

type Notify = (message: string, options?: ToastOptions) => number;

export const ToastContext = createContext<Notify | null>(null);

export function useNotify() {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error("A workbench toast host is required.");
  return notify;
}
