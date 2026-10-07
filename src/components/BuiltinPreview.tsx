import { useMemo } from "react";
import type { BuiltinComponentMetadata } from "./custom/types";
import { Widget } from "./blocks/Widget";
import { nativeComponentDocument } from "../surface/component-insertion";
import { remapSurfaceIds } from "../surface/document.mjs";
import { SurfaceReader } from "../portable/SurfaceReader";
import { useAppearanceTheme } from "../design/useAppearanceTheme";
export function BuiltinPreview({
  component,
  data,
}: {
  component: BuiltinComponentMetadata;
  data: Record<string, unknown>;
}) {
  const theme = useAppearanceTheme();
  const previewData = component.kind.startsWith("g2-")
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
          <h2 style={{ fontSize: 24, margin: 0 }}>
            {String(data.title ?? component.name)}
          </h2>
        }
      />
    </div>
  ) : (
    <Widget kind={component.kind} data={previewData} readOnly />
  );
}
