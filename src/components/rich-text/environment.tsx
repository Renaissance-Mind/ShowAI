import { createContext, type ReactNode } from "react";
import type { useComponentCatalog } from "../useComponentCatalog";
import type { CompiledComponent } from "../custom/types";
import type { BlockProps } from "../blocks/types";
/** The host supplies project resources; all writing tools belong to the component. */
export const RichTextEnvironment = createContext<{
  useCatalog: typeof useComponentCatalog;
  registerComponent: (component: CompiledComponent) => void;
  renderWidget: (props: BlockProps & { kind: string }) => ReactNode;
}>({
  useCatalog: () => ({
    items: [],
    loading: false,
    error: "",
    resolve: async () => {
      throw Error("No component library is connected.");
    },
  }),
  registerComponent: () => {
    throw Error("No component library is connected.");
  },
  renderWidget: ({ kind }) => (
    <span role="status">此宿主未连接组件：{kind}</span>
  ),
});
