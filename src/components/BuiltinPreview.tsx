import { useMemo } from "react";
import type { BuiltinComponentMetadata } from "../contract/types";
import type { BlockProps } from "./blocks/types";
import { Widget } from "./blocks/Widget";
import { nativeComponentDocument } from "../surface/component-insertion";
import { remapSurfaceIds } from "../document/document.mjs";
import { SurfaceReader } from "../portable/SurfaceReader";
import { useAppearanceTheme } from "../design/useAppearanceTheme";

const previewTextHost = { emitInitialUpdate: false };

export function BuiltinPreview({
  component,
  data,
  onChange,
}: {
  component: BuiltinComponentMetadata;
} & Pick<BlockProps, "data" | "onChange">) {
  const theme = useAppearanceTheme();
  const previewData =
    !onChange && component.kind.startsWith("g2-")
      ? {
          ...data,
          theme:
            theme === "dark"
              ? "dark"
              : data.theme === "dark"
                ? "indigo"
                : data.theme,
        }
      : component.kind === "text" && data.color === "#222222"
        ? { ...data, color: "var(--text)" }
        : data;
  const document = useMemo(
    () =>
      component.insertion
        ? remapSurfaceIds(nativeComponentDocument(component.kind, data))
        : null,
    [component.kind, data],
  );
  return document ? (
    <div
      className="native-component-preview"
      style={{ height: 360, width: "100%", minWidth: 0 }}
    >
      <SurfaceReader
        document={document}
        heading={
          component.kind === "region" ? undefined : (
            <h2 style={{ fontSize: 24, margin: 0 }}>
              {String(data.title ?? component.name)}
            </h2>
          )
        }
      />
    </div>
  ) : (
    <Widget
      kind={component.kind}
      data={previewData}
      readOnly={!onChange}
      host={onChange ? previewTextHost : undefined}
      onChange={
        onChange &&
        ((next) =>
          onChange(
            previewData !== data && next.color === "var(--text)"
              ? { ...next, color: data.color }
              : next,
          ))
      }
    />
  );
}
