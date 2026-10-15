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
    "Follow references through guide({skill,file}); no local file access or installed skills are needed. Read only the current task/stage and reuse the exact content already read this turn.",
    "User requests control persistence: save formal work to an authorized project, use render_document only for explicitly standalone output. Do not change scope after connection or save failures.",
    "Scripts are supplied as reference text, never automatically executed. If the host cannot execute a planning check, follow the skill's manual-check fallback and state what was checked.",
  ],
};

export const remoteSkillInstructions =
  'Start every ShowAI task by calling guide() for the shared Skill entrypoint and task routes, even when no plugin Skills are installed. Then read guide({skill:"NAME"}) and referenced files as needed. Read-only lookup stays read-only; complete page requests continue through creation, review, saving and presentation. This is the authorized remote connection; do not use local paths or CLI. Private project IDs come from projects_list; create a project only when requested. ' +
  "The seven workflows cover connection/lookup/reading/recovery (use-showai), page creation/editing/partial presentation/export (show-document), understanding plans (plan-presentation), visual/interaction design (design-presentation), review (review-presentation), reusable components (create-component), and reusable templates (create-template). Read guide topic presentation and current template stage when directed. OAuth is required for private projects; public catalogs and guides need no login. Read the current page/hash/revision before editing. Check saving, synchronization and presentation separately. Unavailable historical snapshots or local library switching must be reported, not simulated. Login codes and credentials are entered by the user in the authorization UI, never requested in chat.";

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
              task: "Read-only connection, project/page search, reading, catalog lookup, conflicts, unavailable history or library switching",
              skill: "use-showai",
            },
            {
              task: "Complete page/report/site creation, continuation, partial display or export; includes a bare topic asking for a finished work",
              skill: "show-document",
            },
            {
              task: "Only plan the reader's understanding path",
              skill: "plan-presentation",
            },
            {
              task: "Only design visuals, layout or interactions",
              skill: "design-presentation",
            },
            {
              task: "Review a real page or design; revise only within the request",
              skill: "review-presentation",
            },
            {
              task: "Develop or revise a reusable component",
              skill: "create-component",
            },
            {
              task: "Create, revise or extract a reusable template; applying a template to an ordinary page uses show-document",
              skill: "create-template",
            },
          ],
        }
      : {}),
  };
}
