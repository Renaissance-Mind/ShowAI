import { useEffect, useId, useMemo } from "react";
import type { BlockProps } from "./types";
import type { SvgData } from "./svg-contract.mjs";
import { sanitizeSvg } from "./svg-sanitize";
import { BlockHeader, EmptyState, blockLabel } from "./shared";
import { InlineMarkup } from "./InlineMarkup";
import { installNotes } from "./NoteText";
import { plainNotes } from "../../document/note-markup.mjs";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/svg";
import "./drawing-palette.css";
import "./svg.css";

/**
 * A drawn figure: the saved SVG source is sanitized, scaled to the page width
 * and themed through the palette classes. Readers only view it; the figure
 * changes through its data.
 */
export function SvgBlock({ data }: BlockProps) {
  const t = useTranslator(messages);
  const model = data as Partial<SvgData>;
  const prefix = `sv${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const label = plainNotes(model.alt ?? "") || t("figure");
  const figure = useMemo(
    () =>
      typeof model.source === "string" && typeof DOMParser !== "undefined"
        ? sanitizeSvg(model.source, prefix, `${prefix}-alt`)
        : null,
    [model.source, prefix],
  );
  const notes = !!figure?.notes;
  useEffect(() => {
    if (notes) installNotes();
  }, [notes]);
  return (
    <figure
      className="sb-block sv-block dw-palette"
      aria-label={blockLabel(model.title, t("figure"))}
    >
      <BlockHeader title={model.title} />
      <span id={`${prefix}-alt`} className="sv-sr">
        {label}
      </span>
      {figure ? (
        <div
          className="sv-canvas"
          style={model.maxWidth ? { maxWidth: model.maxWidth } : undefined}
          dangerouslySetInnerHTML={{ __html: figure.markup }}
        />
      ) : (
        <EmptyState title={t("invalid")} />
      )}
      {model.caption?.trim() && (
        <figcaption className="sv-caption">
          <InlineMarkup source={model.caption} />
        </figcaption>
      )}
    </figure>
  );
}
