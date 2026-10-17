import type { JSONContent } from "@tiptap/core";
import { NativeInkPreview } from "../../surface/NativeInkPreview";
import { safeImageUrl } from "../blocks/helpers";
import { richTextStyle } from "./model.mjs";
import "../blocks/research-media.css";

/** Image content has one presentation in editable documents, SDK blocks and exports. */
export function ImageContent({
  attrs,
}: {
  attrs: NonNullable<JSONContent["attrs"]>;
}) {
  return (
    <figure className="sb-image" style={richTextStyle(attrs.componentStyle)}>
      {attrs.nativeInk ? (
        <NativeInkPreview ink={attrs.nativeInk} />
      ) : attrs.src ? (
        <img
          className="document-image portable-image"
          src={safeImageUrl(attrs.src) || undefined}
          alt={attrs.alt ?? ""}
          title={attrs.title}
          style={{
            width: attrs.width ?? undefined,
            height: attrs.height ?? "auto",
            borderRadius: attrs.componentStyle?.radius,
            ...(attrs.align === "left"
              ? { marginLeft: 0, marginRight: "auto" }
              : attrs.align === "right"
                ? { marginLeft: "auto", marginRight: 0 }
                : {}),
            objectFit: attrs.fit === "cover" ? "cover" : "contain",
          }}
        />
      ) : (
        <div className="sb-image-empty">{attrs.alt || "🖼"}</div>
      )}
      {attrs.caption && <figcaption>{attrs.caption}</figcaption>}
    </figure>
  );
}
