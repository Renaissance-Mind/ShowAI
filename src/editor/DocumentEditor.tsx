import { Widget } from "../components/blocks/Widget";
import type { RichTextEditorProps } from "../components/rich-text/RichTextEditor";
export type DocumentEditorProps = RichTextEditorProps;
export default function DocumentEditor({
  content,
  onChange,
  readOnly,
  minimal: _minimal,
  trailingNode,
  ...host
}: DocumentEditorProps) {
  return (
    <Widget
      kind="text"
      data={{ content, format: "richtext" }}
      readOnly={readOnly}
      host={{
        ...host,
        continuousPage: trailingNode === false,
        onContentChange: onChange,
      }}
    />
  );
}
