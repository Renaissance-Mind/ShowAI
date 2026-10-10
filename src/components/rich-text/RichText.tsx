import { useContext, useMemo, lazy, Suspense } from "react";
import type { JSONContent } from "@tiptap/core";
import type { BlockProps } from "../blocks/types";
import type { RichTextEditorProps } from "./RichTextEditor";
const RichTextEditor = /* @__PURE__ */ lazy(() => import("./RichTextEditor"));
import { RichTextNode } from "./RichTextView";
import { RichTextEnvironment } from "./environment";
import {
  richTextDocument,
  validateRichTextData,
  richTextStyle,
} from "./model.mjs";
import "../blocks/katex.css";

export type RichTextHost = Pick<
  RichTextEditorProps,
  "additionalExtensions" | "onEditorReady" | "onInsertNative" | "onDetachBlock"
> & {
  continuousPage?: boolean;
  onContentChange?: (
    content: JSONContent,
    options?: { separateHistory?: boolean },
  ) => void;
};
/** One text component for direct typing, catalog insertion, AI input and the SDK. */
export function RichText({
  data,
  onChange,
  readOnly,
  host,
}: BlockProps & { host?: RichTextHost }) {
  validateRichTextData(data);
  const content = useMemo(
    () => richTextDocument(data),
    [data.content, data.format],
  );
  const { renderWidget } = useContext(RichTextEnvironment);
  const editable = !readOnly && !!(onChange || host?.onContentChange);
  const style = richTextStyle(data);
  return (
    <section
      className="sb-primitive sb-text rich-text-component"
      data-component-kind="text"
      aria-label="富文本"
      style={style}
    >
      {editable ? (
        <Suspense fallback={<div role="status">正在打开富文本…</div>}>
          <RichTextEditor
            {...host}
            trailingNode={!host?.continuousPage}
            content={content}
            readOnly={false}
            onChange={(next, options) => {
              if (host?.onContentChange) host.onContentChange(next, options);
              else onChange?.({ ...data, content: next, format: "richtext" });
            }}
          />
        </Suspense>
      ) : (
        <div className="sb-rich-text portable-content">
          <RichTextNode
            node={content}
            renderWidget={(kind, data) =>
              renderWidget({ kind, data, readOnly: true })
            }
          />
        </div>
      )}
    </section>
  );
}
