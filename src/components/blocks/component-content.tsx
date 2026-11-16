import { richTextDocument } from "../../document/rich-text.mjs";
import { componentSlotValues } from "../../contract/component-contract.mjs";
import { RichTextContent } from "../rich-text/RichTextView";
import {
  useComponentRuntime,
  useComponentRuntimeContext,
} from "./component-runtime";
import type { ComponentRuntime } from "../../contract/component-runtime.mjs";
import type { BlockProps } from "./types";
import type { ReactNode } from "react";
import "../rich-text/editor.css";

export function ComponentContent({
  slot,
  index,
}: {
  slot: string;
  index?: number;
}) {
  const context = useComponentRuntimeContext();
  const runtime = useComponentRuntime();
  return renderComponentContent({
    slot,
    index,
    runtime,
    renderWidget: context?.renderWidget,
  });
}
export function renderComponentContent({
  slot,
  index,
  runtime,
  renderWidget,
}: {
  slot: string;
  index?: number;
  runtime: ComponentRuntime;
  renderWidget?: (props: BlockProps & { kind: string }) => ReactNode;
}) {
  if (index !== undefined && (!Number.isInteger(index) || index < 0))
    throw new Error("Content slot index must be a nonnegative integer");
  const definition = runtime.contract.slots?.find(
    (entry) => entry.name === slot,
  );
  if (!definition) throw new Error("Undeclared content slot: " + slot);
  const entries = componentSlotValues(
    runtime.contract,
    runtime.data,
    definition,
  );
  const selected =
    index === undefined ? entries : entries.slice(index, index + 1);
  return (
    <>
      {selected.map((entry, position) => (
        <RichTextContent
          key={position}
          content={
            typeof entry.value === "string"
              ? richTextDocument({ content: entry.value })
              : entry.value
          }
          renderWidget={(kind, data, inline) => {
            if (!renderWidget)
              throw new Error(
                "No renderer was declared for content component: " + kind,
              );
            return renderWidget({ kind, data, inline, readOnly: true });
          }}
        />
      ))}
    </>
  );
}
