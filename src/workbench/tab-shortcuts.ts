import type { TabCommand } from "../host/protocol";

/** The command modifier: ⌘ alone on macOS, where Ctrl+letter edits text; Ctrl elsewhere. */
export function commandKey(
  input: { metaKey: boolean; ctrlKey: boolean },
  mac: boolean,
) {
  return mac
    ? input.metaKey && !input.ctrlKey
    : input.ctrlKey && !input.metaKey;
}

export function tabShortcut(
  input: {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  },
  mac: boolean,
): TabCommand | undefined {
  if (input.altKey) return;
  if (input.ctrlKey && !input.metaKey && input.key === "Tab")
    return input.shiftKey ? "previous" : "next";
  if (!commandKey(input, mac) || input.shiftKey) return;
  if (input.key.toLowerCase() === "t") return "new";
  if (input.key.toLowerCase() === "w") return "close";
}
