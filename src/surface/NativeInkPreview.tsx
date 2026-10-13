import "./native-ink.css";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/nativeInk";
export function NativeInkPreview({
  ink,
}: {
  ink: { extent: [number, number]; preview: string; darkPreview?: string };
}) {
  const t = useTranslator(messages);
  const [width, height] = ink.extent;
  return (
    <svg
      className="board-drawing native-ink-preview"
      data-native-ink
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={t("ink")}
      style={{ display: "block", width: "100%", height: "100%" }}
    >
      <image
        className={ink.darkPreview ? "board-ink-light" : undefined}
        href={ink.preview}
        width={width}
        height={height}
        preserveAspectRatio="none"
      />
      {ink.darkPreview && (
        <image
          className="board-ink-dark"
          href={ink.darkPreview}
          width={width}
          height={height}
          preserveAspectRatio="none"
        />
      )}
    </svg>
  );
}
