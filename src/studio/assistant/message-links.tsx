import type { ReactNode } from "react";

/** Render Markdown links in Agent replies: web links open, workspace paths download. */
export function messageLinks(
  text: string,
  download: (path: string) => void,
): ReactNode[] {
  const output: ReactNode[] = [];
  let position = 0;
  for (const match of text.matchAll(
    /\[([^\]\n]+)\]\((?:<([^>]+)>|([^\)\n]+))\)/g,
  )) {
    output.push(text.slice(position, match.index));
    const href = match[2] ?? match[3];
    if (/^https?:\/\//i.test(href))
      output.push(
        <a key={match.index} href={href} target="_blank" rel="noreferrer">
          {match[1]}
        </a>,
      );
    else if (
      href.startsWith("/") ||
      href.startsWith("./") ||
      /^[A-Za-z]:[\\/]/.test(href)
    )
      output.push(
        <button
          key={match.index}
          className="agent-file-link"
          onClick={() => download(href)}
        >
          {match[1]}
        </button>,
      );
    else output.push(match[0]);
    position = match.index! + match[0].length;
  }
  output.push(text.slice(position));
  return output;
}

/** Save a file from an Agent task workspace through the host. */
export async function downloadAgentFile(
  invoke: <T>(action: string, args?: Record<string, unknown>) => Promise<T>,
  id: string,
  path: string,
  projectId?: string,
) {
  const file = await invoke<{ name: string; mime: string; base64: string }>(
    "agent:readFile",
    { id, path, ...(projectId ? { projectId } : {}) },
  );
  const bytes = Uint8Array.from(atob(file.base64), (character) =>
    character.charCodeAt(0),
  );
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
