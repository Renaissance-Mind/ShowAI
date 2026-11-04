import { createHash } from "node:crypto";
import { posix } from "node:path";
import { mcpSkillNames, mcpSkillSources } from "./mcp-skill-source.generated";

export { mcpSkillNames };

const sourceHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const context = {
  transport: "http",
  projects: "authorized",
  rules: [
    "This is the remote HTTP connection. Apply the remote branches of the shared skills. Never ask this client to configure a local launcher, read a local content library, run ShowAI CLI commands, or pass local filesystem paths to remote tools.",
    "Use only tools actually exposed by this connection and their current input schemas. Some shared references document local-only operations; explain unavailable capabilities rather than inventing tools or changing connections.",
    "Follow references through guide({skill,file}); no local file access or installed skills are needed. Read only what the current task needs and reuse the exact content already read this turn.",
    "User requests control persistence: a visualization to see now uses show_component (nothing saved); work to keep is saved to an authorized project; render_document is only for a complete standalone document. Do not change scope after connection or save failures.",
    "Scripts are supplied as reference text, never automatically executed. If the host cannot execute a planning check, follow the skill's manual-check fallback and state what was checked.",
  ],
};

export const remoteSkillInstructions =
  'Start every ShowAI task by calling guide() for the shared Skill entrypoint and task routes, even when no plugin Skills are installed. Then read guide({skill:"NAME"}) and referenced files as needed. Read-only lookup stays read-only; complete page requests continue through creation, review, saving and presentation. This is the authorized remote connection; do not use local paths or CLI. Private project IDs come from projects_list; create a project only when requested. ' +
  "The host may defer tool definitions. The guide response lists this connection's actual tools and MCP URL. If a required tool is listed but not currently loaded, use the host's tool discovery scoped to this selected connection before claiming it is unavailable. Do not switch to another similarly named ShowAI connection. Tool availability and OAuth scope are separate; report the actual discovery or authorization error. " +
  "use-showai is the entry: it routes the request and holds the connection, ownership, content model and saving rules. The six workflows are use-showai (connection, lookup, reading, references, shared data, recovery), show-visual (components shown in the conversation without saving, including adapting or writing one), show-document (creating or revising a work: the whole presentation workflow from reader intent to review and delivery, read once), create-component (reusable components), create-template (reusable templates) and collaborate-canvas (collaborative canvas and paired devices). A selected template is read whole once with template_context. Records of each stage stay in the conversation on this remote connection. OAuth is required for private projects; public catalogs and guides need no login. Read the current page/hash/revision before editing. Check saving, synchronization and presentation separately. Unavailable historical snapshots or local library switching must be reported, not simulated. Login codes and credentials are entered by the user in the authorization UI, never requested in chat.";

function metadata(name: string) {
  const source = mcpSkillSources[`${name}/SKILL.md`];
  if (!source) throw new Error(`Unknown ShowAI skill: ${name}`);
  const description = source.match(/^description: (.+)$/m)?.[1];
  if (!description) throw new Error(`Missing description for ${name}`);
  return {
    name,
    description,
    read: { tool: "guide", arguments: { skill: name } },
  };
}

function reference(path: string, href: string) {
  if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href)) return undefined;
  const [file, anchor] = href.split("#", 2);
  const resolved = posix.normalize(
    posix.join(posix.dirname(path), decodeURIComponent(file)),
  );
  if (!(resolved in mcpSkillSources))
    throw new Error(`Missing bundled skill reference: ${path} → ${href}`);
  const [skill, ...parts] = resolved.split("/");
  return {
    tool: "guide",
    arguments: {
      skill,
      file: parts.join("/"),
      ...(anchor ? { section: decodeURIComponent(anchor) } : {}),
    },
  };
}

/** No arbitrary filesystem reads: every source and reference is a bundled allowlist entry. */
export function mcpSkillGuide(
  options: {
    skill?: string;
    file?: string;
    section?: string;
    knownHash?: string;
  } = {},
) {
  const {
    skill = "use-showai",
    file = "SKILL.md",
    section,
    knownHash,
  } = options;
  metadata(skill);
  const path = `${skill}/${file}`;
  if (
    file.includes("\\") ||
    file.split("/").some((part) => !part || part === "." || part === "..") ||
    !(path in mcpSkillSources)
  )
    throw new Error(
      "Unknown skill file. Use an exact file returned by guide; paths cannot leave the bundled skill.",
    );
  const source = mcpSkillSources[path];
  const links: {
    label: string;
    tool: string;
    arguments: Record<string, string>;
  }[] = [];
  const markdown = source.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (original, label: string, href: string) => {
      const link = reference(path, href);
      if (!link) return original;
      links.push({ label, ...link });
      return `${label}（读取 \`guide(${JSON.stringify(link.arguments)})\`）`;
    },
  );
  const hash = sourceHash(markdown);
  return {
    protocol: "showai-remote-skills-v1",
    skill,
    file,
    ...(section
      ? {
          requestedSection: section,
          sectionNote:
            "The complete file is returned; locate this heading without losing its surrounding instructions.",
        }
      : {}),
    source: { path: `plugins/showai/skills/${path}`, hash: sourceHash(source) },
    hash,
    unchanged: knownHash === hash,
    ...(knownHash === hash ? {} : { markdown }),
    context,
    links,
    files: Object.keys(mcpSkillSources)
      .filter((name) => name.startsWith(`${skill}/`))
      .map((name) => ({
        file: name.slice(skill.length + 1),
        read: {
          tool: "guide",
          arguments: { skill, file: name.slice(skill.length + 1) },
        },
      })),
    ...(!options.skill
      ? {
          entrypoint: true,
          skills: mcpSkillNames.map(metadata),
          routing: [
            {
              task: "Read-only connection, project/page search, reading, references, shared data, organization, conflicts, drafts, unavailable history or library switching (nothing is written to a work)",
              skill: "use-showai",
            },
            {
              task: "Show one to five components (chart, diagram, mechanism, simulation, comparison, UI mockup) in the conversation without a project or saving; adapt or write a component when none fits",
              skill: "show-visual",
            },
            {
              task: "Create or revise a work to keep (page, report, explainer, small site), including a bare topic asking for a finished work, only a plan or design draft, a review of a page, display or export; applying a template to a page",
              skill: "show-document",
            },
            {
              task: "Develop or revise a reusable component",
              skill: "create-component",
            },
            {
              task: "Create, revise or extract a reusable template",
              skill: "create-template",
            },
            {
              task: "Collaborate with a person who keeps drawing or editing; optional spatial references, multiple Agent conversations, iPad/Mac pairing and disconnect recovery",
              skill: "collaborate-canvas",
            },
          ],
        }
      : {}),
  };
}
