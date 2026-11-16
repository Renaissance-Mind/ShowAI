import { attachStyles } from "./cdn-styles";
import { mountReader } from "./reader-app";

let count = 0;

export interface CdnMountOptions {
  artifact: string | object;
  options?: { theme?: "dark" | "light"; draft?: boolean };
  standalone?: boolean;
}

export function mount(
  section: HTMLElement,
  { artifact, options, standalone = false }: CdnMountOptions,
) {
  if (!section.id) section.id = `showai-cdn-${++count}`;
  if (!/^[A-Za-z][\w-]*$/.test(section.id))
    throw new Error("The ShowAI root needs a simple id.");
  if (!standalone) section.setAttribute("data-showai-inline-root", "");
  section
    .querySelectorAll(":scope > [data-showai-placeholder]")
    .forEach((placeholder) => placeholder.remove());
  const target = section.ownerDocument.createElement("div");
  target.id = `${section.id}-root`;
  section.append(target);
  const detachStyles = attachStyles(section, { scoped: !standalone });
  const raw =
    typeof artifact === "string" ? artifact : JSON.stringify(artifact);
  const readOptions = options ? JSON.stringify(options) : null;
  const unmount = mountReader(target, {
    inlineHost: standalone ? null : section,
    readArtifact: () => raw,
    readOptions: () => readOptions,
    setTheme: (theme) => {
      (standalone
        ? section.ownerDocument.documentElement
        : section
      ).dataset.theme = theme;
    },
  });
  const dispose = () => {
    unmount();
    detachStyles();
    target.remove();
  };
  return Object.assign(dispose, {
    update: (artifact: string | object) =>
      unmount.update(typeof artifact === "string" ? artifact : JSON.stringify(artifact)),
    read: unmount.read,
  });
}
