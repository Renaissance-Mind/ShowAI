import { noteSegments } from "../../document/note-markup.mjs";
import { installNoteBubbles } from "./note-bubble";

export const installNotes = () => installNoteBubbles();

export const noteProps = (note: string, focusable = true) => {
  installNoteBubbles();
  return {
    className: "showai-note",
    "data-showai-note": note,
    ...(focusable ? { tabIndex: 0 } : {}),
  };
};

export function NoteText({
  text,
  focusable = true,
}: {
  text: unknown;
  focusable?: boolean;
}) {
  return (
    <>
      {noteSegments(text).map((segment, index) =>
        segment.type === "note" ? (
          <span key={index} {...noteProps(segment.note, focusable)}>
            {segment.text}
          </span>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}

export function NoteSvgText({ text }: { text: unknown }) {
  return (
    <>
      {noteSegments(text).map((segment, index) =>
        segment.type === "note" ? (
          <tspan key={index} {...noteProps(segment.note, false)}>
            {segment.text}
          </tspan>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}
