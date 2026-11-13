import { COMMANDS_BY_KEY } from "./commands";

/**
 * The sections of showai --help: a title and the commands it lists, by key.
 * Each command contributes its own help lines. An inline section puts its
 * first line on the title line.
 */
const SECTIONS: readonly {
  title: string;
  inline?: true;
  commands: readonly string[];
}[] = [
  {
    title: "Local browser workbench (same files as the desktop app and CLI):",
    commands: ["serve"],
  },
  {
    title:
      "Independent presentation (no personal project or synchronization required):",
    commands: ["public list", "public describe", "render"],
  },
  { title: "MCP connections:", commands: ["mcp", "mcp serve"] },
  {
    title: "Start with one project:",
    commands: [
      "runtime",
      "projects current",
      "projects list",
      "projects create",
      "projects bind",
      "pages list",
    ],
  },
  {
    title:
      "Change pages (save and apply reply with a receipt; --response source adds the document):",
    commands: [
      "pages save",
      "pages apply",
      "pages delete",
      "pages duplicate",
      "pages deleted",
    ],
  },
  {
    title:
      "Shared datasets (one value that blocks on several pages read and write; see guide datasets):",
    commands: [
      "datasets list",
      "datasets read",
      "datasets create",
      "datasets apply",
      "datasets link",
      "datasets transform",
      "datasets delete",
    ],
  },
  {
    title: "Import from other apps (a file, a folder or a zip; see guide import):",
    commands: ["import", "importers"],
  },
  {
    title: "Discover only what you need:",
    commands: [
      "guide",
      "template import",
      "template export",
      "template context",
      "catalog list",
      "catalog describe",
      "catalog remove",
    ],
  },
  {
    title: "Display a full page or selected blocks:",
    commands: ["export"],
  },
  {
    title: "Read one Page through structured data, an image or interactive HTML:",
    commands: ["boards read", "pages read"],
  },
  {
    title: "Versioned libraries:",
    inline: true,
    commands: [
      "library init",
      "library stats",
      "library rebuild-index",
      "library archive",
      "library import",
      "library activate",
      "library migrate",
      "library imports",
      "search",
      "workspace merge",
      "workspace conflicts",
    ],
  },
];

const FOOTER = [
  "Shared: --home PATH, --project ID, --json, --help.",
  "Project defaults to the host project directory (Git root of cwd); --project overrides it.",
  "Shared promotion/registration is explicit.",
  "Use showai guide TOPIC for exact authoring, versioning and delivery commands.",
];

/** Command keys showai --help lists, in order. */
export const HELP_COMMANDS = SECTIONS.flatMap((section) => section.commands);
export const HELP_FOOTER = FOOTER;

function sectionText(section: (typeof SECTIONS)[number]) {
  const lines = section.commands.flatMap((key) => {
    const declaration = COMMANDS_BY_KEY.get(key);
    if (!declaration?.help) throw new Error(`No help for ${key}.`);
    return declaration.help.map((line) => "  " + line);
  });
  return section.inline
    ? [`${section.title} ${lines[0].trimStart()}`, ...lines.slice(1)]
    : [section.title, ...lines];
}

/** The text of showai --help, built from the command declarations. */
export function cliHelp() {
  const sections = SECTIONS.map(sectionText);
  return [
    "ShowAI — interactive pages shared by people and Agents.",
    "",
    ...sections.slice(0, -1).flatMap((lines) => [...lines, ""]),
    ...sections[sections.length - 1],
    ...FOOTER,
  ].join("\n") + "\n";
}
