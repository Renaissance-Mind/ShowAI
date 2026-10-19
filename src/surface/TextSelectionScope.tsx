import { useEffect, useRef, type ComponentProps } from "react";
import { installPageTextSelection } from "./text-selection";

export function TextSelectionScope(props: ComponentProps<"div">) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => installPageTextSelection(root.current!), []);
  return <div {...props} ref={root} />;
}
