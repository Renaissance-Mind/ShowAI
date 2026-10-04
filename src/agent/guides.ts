export const GUIDE_TOPICS = [
  "workspace",
  "authoring",
  "document",
  "catalog",
  "component",
  "templates",
  "template-extraction",
  "versions",
  "export",
  "publish",
] as const;
export type GuideTopic = (typeof GUIDE_TOPICS)[number];

const guides: Record<
  GuideTopic,
  {
    purpose: string;
    rules: string[];
    commands: string[];
    input?: unknown;
    next?: string;
  }
> = {
  workspace: {
    purpose:
      "Bind one conversation to an explicit ShowAI project, shared with the desktop application.",
    rules: [
      "Storage defaults to ~/.showai; use --home or SHOWAI_HOME to match the desktop content library.",
      "Use the actual harness/session identifier. projects current only reports an existing binding; it never chooses the most recent project.",
      "All page and project-catalog writes require --project. Reuse a different project only when the user selects it.",
    ],
    commands: [
      "showai projects current --harness codex --session SESSION_ID --json",
      "showai projects list --json",
      "showai projects create --name 'Research topic' --harness codex --session SESSION_ID --json",
      "showai projects bind PROJECT --harness codex --session SESSION_ID --json",
      "showai pages list --project PROJECT --json",
    ],
  },
  authoring: {
    next: "showai guide document --json",
    purpose:
      "Create or revise page content without overwriting edits made by the user or another Agent.",
    rules: [
      "Read the page, retain its hash and stable block ids, and inspect pages diff against the preceding turn's hash.",
      "Save/apply requires --base-hash. On CONFLICT, read and merge deliberately; do not blindly retry an old document with a newer hash.",
      "Page content is the validated document tree. Query a component's schema and examples only when adding that component.",
    ],
    commands: [
      "showai pages create --project PROJECT --title 'Research result' --json",
      "showai pages create --project PROJECT --input page.showai.json --json",
      "showai pages read PAGE --project PROJECT --json",
      "showai pages diff PAGE --project PROJECT --since PREVIOUS_HASH --json",
      "showai pages apply PAGE --project PROJECT --input operations.json --base-hash CURRENT_HASH --json",
      "showai pages save PAGE --project PROJECT --input page.showai.json --base-hash CURRENT_HASH --json",
    ],
    input: {
      operations: [
        { type: "page.set", fields: { title: "Updated finding" } },
        {
          type: "block.text.set",
          blockId: "STABLE_BLOCK_ID",
          text: "Supported finding.",
        },
      ],
      otherOperations: [
        "block.insert: node, parentId?, afterId?",
        "block.remove: blockId",
        "block.replace: blockId, node",
        "block.move: blockId, parentId?, afterId?",
        "block.attrs.set: blockId, attrs",
      ],
    },
  },
  document: {
    purpose:
      "Read the page JSON format only when authoring document blocks directly.",
    rules: [
      "A .showai.json artifact wraps {format:'showai',version:1,document}. pages create/save also accept the document object directly.",
      "A document requires id, title and a doc content node. The store assigns the page identity and stable attrs.id values; retain existing block ids when revising.",
      "Text nodes use {type:'text',text,marks?}; empty paragraphs have content:[] rather than an empty text node.",
      "Headings use attrs.level 1–3. Lists contain listItem children starting with a paragraph. taskList contains taskItem with attrs.checked. Tables contain tableRow then tableCell/tableHeader, each containing paragraphs/blocks.",
      "Links use a link mark with attrs.href. Code uses codeBlock with text children and optional attrs.language. Callout/toggle contain blocks; toggle attrs.title/open configure its heading.",
      "Images use attrs.src and alt; offline delivery needs an embedded raster data URI. A widget uses attrs.kind plus attrs.data. Query that component's guide/schema/examples before supplying data.",
    ],
    commands: [
      "showai catalog describe chart --view guide --json",
      "showai pages create --project PROJECT --input page.showai.json --json",
    ],
    input: {
      format: "showai",
      version: 1,
      document: {
        id: "authored-source",
        title: "A supported finding",
        content: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "Finding" }],
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "Describe the evidence." }],
            },
          ],
        },
      },
    },
    next: "showai guide authoring --json",
  },
  catalog: {
    purpose:
      "Discover suitable components or templates with small summaries; request only the detail needed for the next operation.",
    rules: [
      "catalog list returns items, total, limit and nextCursor. Default limit is 20, maximum 50. Restart without a cursor if the catalog changed.",
      "Scopes are builtin, global, published and project. Shared scopes are immutable; author changes in an explicitly selected project.",
      "describe defaults to summary. Component summaries contain purpose, scenarios and effects; template summaries contain scenarios. No schema, default data, page body or code is included.",
      "Views: guide for usage, schema for props, examples for presets, dependencies for exact references, source for original code/template definition, full for all descriptive metadata. full still excludes source and executable runtimes.",
      "All canvas content is available as components: text, image, table, callout, toggle, divider, code and the interactive components. Insert builtin widgets with kind and data; request schema/examples before authoring. Text supports Markdown or plain content and appearance props.",
      "Builtins expose an editable starting source. Read --view source, choose a new manifest id/version, then save it in the selected project.",
      "Compose in code with named imports from showai:components (Text, Image, Table, Callout, Toggle, Divider, Code, Chart, Database, Metrics, Playground, Gallery, Bookmark). Import custom children from showai:component/ID after declaring their exact refs in manifest.dependencies. Pass data, readOnly and onChange to each child. Compiled parents contain their children; promotion/publication copies the source dependency closure.",
      "Component source shows the entry file and a file index. Add --file PATH for a particular file or --file '*' for the complete original package.",
    ],
    commands: [
      "showai catalog list --kind component --project PROJECT --limit 10 --json",
      "showai catalog list --kind template --scope global --query report --json",
      "showai catalog describe ID --kind component --project PROJECT --view guide --json",
      "showai catalog describe ID --kind component --project PROJECT --view schema --json",
      "showai catalog describe ID --kind component --project PROJECT --view examples --json",
      "showai catalog describe ID --kind component --project PROJECT --view source --json",
      "showai catalog import --project PROJECT --input ./component-package --json",
      "showai catalog save --project PROJECT --input component-source.json --json",
    ],
  },
  component: {
    purpose:
      "Create a reusable React component only after reuse and composition leave a real expression or interaction gap.",
    rules: [
      "Describe input data, reader actions and resulting state before choosing an implementation. Search component summaries first; read source only for the chosen component being changed.",
      "A local package contains manifest.json, props.schema.json and its React entry. The entry receives {data, onChange, readOnly}; onChange persists valid edits, while reading interactions keep source content unchanged.",
      "manifest needs id, name, version, description, scenarios, entry, defaultData and examples. Default data and every example must pass the schema.",
      "Use React, package-local imports or showai:components, including Flowchart. Custom children use showai:component/ID with exact manifest.dependencies refs. External npm libraries belong in the installed ShowAI runtime, not the skill package.",
      "Import into the selected project, use it in a real page and check the main interaction in desktop and exported HTML. New versions are immutable; shared promotion is explicit.",
    ],
    commands: [
      "showai catalog list --kind component --project PROJECT --query PURPOSE --limit 8 --json",
      "showai catalog describe ID --kind component --project PROJECT --view source --file index.tsx --json",
      "showai catalog import --project PROJECT --input ./component-package --json",
      "showai catalog save --project PROJECT --input component-source.json --json",
      "showai export --project PROJECT --page PAGE --format html --out ./component-preview.html --json",
    ],
  },
  "template-extraction": {
    purpose:
      "Abstract a user-selected mature page into a reusable template while preserving the original example.",
    rules: [
      "Trigger when the user asks to save or extract a template. Finishing a page does not automatically create a template.",
      "Read the current page and compare prior hash before extraction. Separate stable narrative/layout from instance facts, data and optional sections.",
      "Replace instance content with filling guidance or honest empty states; describe input requirements in contentGuide, contexts in scenarios, component roles in related and realistic use in examples.",
      "Current templates store document/composition and Agent-facing instructions. They are not an automatic variable-binding system. Saving --page alone is a snapshot; use --input for the abstracted definition.",
      "Save in the project, apply to a new page and verify with different source material. Preserve the source page. Promote or publish only when requested.",
    ],
    commands: [
      "showai pages read PAGE --project PROJECT --json",
      "showai pages diff PAGE --project PROJECT --since PREVIOUS_HASH --json",
      "showai catalog list --kind template --project PROJECT --query PURPOSE --limit 8 --json",
      "showai template save --project PROJECT --input template-definition.json --json",
      "showai template apply ID --project PROJECT --scope project --version VERSION --title 'Different content' --json",
    ],
    input: {
      id: "reusable-report",
      version: "1.0.0",
      name: "Report",
      description: "Reusable content structure",
      scenarios: ["REPORT_CONTEXT"],
      contentGuide: [
        {
          title: "Evidence",
          instructions: ["Fill with source-backed observations"],
        },
      ],
      related: [],
      examples: [],
      document: "ABSTRACTED_DOCUMENT_FROM_SELECTED_PAGE",
    },
  },
  templates: {
    purpose:
      "Use or compose reusable content structures while keeping template revisions immutable.",
    rules: [
      "Use a template's scenarios to choose it, guide to learn its content structure and related resources, and examples to see realistic sequences.",
      "Applying a template creates a new page. Composition expands referenced templates through the core and preserves exact dependency revisions.",
      "Save accepts a page or an input file with name, description, version, scenarios, contentGuide, related, examples and optional document/composition. To revise an existing template id, use a new version.",
      "A composition part is either {type:'content', content:DOC_NODE} or {type:'template', ref:EXACT_REF, title?:TEXT}. The core pins referenced integrity. Query --view dependencies to inspect the resulting graph.",
    ],
    commands: [
      "showai catalog describe ID --kind template --project PROJECT --view guide --json",
      "showai catalog describe ID --kind template --project PROJECT --view examples --json",
      "showai template apply ID --project PROJECT --scope global --version VERSION --title 'My result' --json",
      "showai template save --project PROJECT --page PAGE --name 'Report' --version 1.0.0 --json",
      "showai template save --project PROJECT --input template-definition.json --json",
      "showai catalog describe ID --kind template --project PROJECT --view source --out template-source.json --json",
    ],
  },
  versions: {
    purpose:
      "Fork, compare, merge and explicitly promote immutable package revisions.",
    rules: [
      "Copy exact refs from catalog results; they contain kind, id, version, integrity and scope, plus projectId for project-owned revisions.",
      "Fork writes a new project revision. Merge preview is read-only; inspect conflicts before supplying a resolved editable package and a new version.",
      "Preview defaults to a conflict summary. Use --out preview.json to retain the complete editable merge candidate, or --view source to return it explicitly.",
      "Promotion to global is a deliberate local-library write: --to global is required. It does not upload anything. Project-bound MCP connections cannot promote or register shared published libraries.",
    ],
    commands: [
      "showai catalog fork --project PROJECT --input ref.json --id local-variant --version 1.0.0 --json",
      "showai catalog merge preview --project PROJECT --input merge-input.json --out merge-preview.json --json",
      "showai catalog merge resolve --project PROJECT --input resolved-merge.json --json",
      "showai catalog promote --project PROJECT --input ref.json --to global --json",
    ],
    input: {
      ref: {
        kind: "component",
        id: "COMPONENT_ID",
        version: "1.0.0",
        integrity: "EXACT_INTEGRITY",
        scope: "project",
        projectId: "PROJECT",
      },
      preview: { base: "EXACT_REF", ours: "EXACT_REF", theirs: "EXACT_REF" },
      resolve: {
        base: "EXACT_REF",
        ours: "EXACT_REF",
        theirs: "EXACT_REF",
        version: "NEW_VERSION",
        resolved: "EDITABLE_PACKAGE_FROM_REVIEWED_PREVIEW",
      },
    },
  },
  export: {
    purpose:
      "Deliver one page or a static website without carrying the authoring workbench.",
    rules: [
      "bundled is the default: reader, content and exact component runtimes are included. Raster images must be embedded for offline delivery.",
      "remote requires previously verified published component locators and network access when reading. It does not implicitly upload or publish components.",
      "inline must use bundled components and fit the host's size limit. Rendering a conversation fragment requires a supported host display surface; MCP alone does not supply one.",
      "A whole-project site omits archived pages. Existing deliverables require explicit --overwrite. Export outside authoring sources or into the selected project's exports directory.",
    ],
    commands: [
      "showai export --project PROJECT --page PAGE --format html --components bundled --out ./report.html --json",
      "showai export --project PROJECT --page PAGE --format inline --components bundled --out ./report-inline.html --json",
      "showai export --project PROJECT --format site --components remote --out ./site --json",
    ],
  },
  publish: {
    purpose:
      "Prepare immutable publication files, then explicitly verify and register a hosted release.",
    rules: [
      "prepare writes a local publication directory. It does not upload files or make them public.",
      "Upload the prepared directory to your chosen static host as a separate, explicitly requested operation. Keep exact versioned files immutable.",
      "verify fetches the supplied manifest and exact runtime bytes, checks integrity, then registers the release in the local shared published library. register is an alias for this same verification, not a bypass.",
      "Global promotion and published registration are only available through explicit CLI or desktop actions; project-bound MCP tools cannot mutate these shared scopes.",
    ],
    commands: [
      "showai publish prepare --project PROJECT --input publication-refs.json --out ./publication --json",
      "showai publish verify --project PROJECT --url MANIFEST_URL --json",
      "showai publish list --limit 20 --json",
      "showai export --project PROJECT --page PAGE --format html --components remote --out ./report.html --json",
    ],
    input: {
      refs: [
        {
          kind: "component",
          id: "COMPONENT_ID",
          version: "VERSION",
          integrity: "EXACT_INTEGRITY",
          scope: "global",
        },
      ],
    },
  },
};

export function getGuide(topic?: string) {
  if (!topic)
    return {
      purpose:
        "ShowAI turns project content into interactive pages. Read one guide only when its operation is needed.",
      topics: GUIDE_TOPICS.map((name) => ({
        topic: name,
        purpose: guides[name].purpose,
        next: `showai guide ${name} --json`,
      })),
    };
  if (!GUIDE_TOPICS.includes(topic as GuideTopic))
    throw new Error(
      `Unknown guide '${topic}'. Available topics: ${GUIDE_TOPICS.join(", ")}.`,
    );
  return { topic, ...guides[topic as GuideTopic] };
}
