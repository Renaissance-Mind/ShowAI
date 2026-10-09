export const GUIDE_TOPICS = [
  "integration",
  "workspace",
  "authoring",
  "reading",
  "document",
  "whiteboard",
  "containers",
  "catalog",
  "component",
  "templates",
  "template-extraction",
  "versions",
  "history",
  "sync",
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
  integration: {
    purpose:
      "Use common ShowAI capabilities across harnesses, choosing display and synchronization independently.",
    rules: [
      "Discover actual capabilities with runtime info (CLI) or showai_capabilities (MCP). Harness names do not prove inline, MCP Apps, shell or filesystem support.",
      "Public components/templates and customization do not require a personal project or synchronization. public list/describe and render are the CLI equivalents of public_catalog_list/describe and render_document.",
      "render input is {document?,templateId?,title?,componentSources?}; supply document or templateId. componentSources use the editable manifest/schema/source/files/assets contract from guide component. Rendering returns HTML, inline and source plus savedToProject=false/synchronized=false.",
      "For persistent work use the selected local project or OAuth-authorized remote project. Remote tools require projectId from projects_list and never accept local filesystem paths. CLI and project-bound stdio use the actual local project.",
      "Remote writes pull before operating and push afterward. Inspect isError, ok and synchronization.state/error/remoteHead. A retained local result with failed sync must not be reported as published. Cross-device conflicts retain both versions and may return a new page ID; same-device conflicts require explicit resolution.",
      "Display is optional: MCP Apps uses render_document/page_present; other inline hosts use their actual rendering contract. Text-only hosts can write shared projects and return a receipt; the user sees synchronized results in ShowAI.",
      "Local CLI, stdio and HTTP reuse content operations. Authentication and host rendering are adapters. Only claim a named harness has been tested when it actually has.",
    ],
    commands: [
      "showai runtime info --json",
      "showai public list --kind template --json",
      "showai public describe explainer --view source --json",
      "showai render --input presentation.json --out /OUTPUT/page.html --json",
      "showai mcp --public",
      "showai mcp --project PROJECT",
      "showai mcp serve --state /PRIVATE_STATE --public-url https://YOUR_MCP_ORIGIN --sync-server https://YOUR_SHOWAI_SERVER --port 8789",
    ],
    input: {
      document: "Complete Page/Board document",
      componentSources: "Editable component packages, optional",
      display: "Determined by the harness",
      synchronization: "Determined by the project connection",
    },
  },
  sync: {
    purpose:
      "Connect project-scoped servers, inspect synchronization, join invitations and retain complete history across devices.",
    rules: [
      "Servers manage projects with admin, editor and viewer roles. Identity and tokens are per server; each local project binds one server project and one account connection. There is no server administrator or owner role.",
      "Settings → 服务器与同步 configures connections, the default storage for future projects, project accounts, invitation acceptance and the embedded project Dashboard. Existing local projects are attached explicitly; default changes do not upload existing projects.",
      "Use real connection/project IDs returned by status/projects. Credentials come from password-file/token-file/registration-key-file or SHOWAI_SERVER_PASSWORD/SHOWAI_SERVER_TOKEN/SHOWAI_REGISTRATION_KEY. Outputs omit connection tokens. view register creates a password account; configured deployment currently supports password and token authentication.",
      "The running desktop/browser workbench synchronizes in the background. A standalone Agent can explicitly invoke sync run after local writes; disconnected edits and revisions remain on disk. A local save is not proof of successful remote publication: inspect project status/error and remoteHead.",
      "Project transfer includes formal history, source/compiled dependencies and archived readers. Shared local library Git IDs differ from remote snapshot IDs; syncOrigin preserves original time/actor/source revision/remote parents. Device paths and directory bindings remain local. Never upload the whole content library to share one project.",
      "Viewer/revoked connections cannot commit project edits. Same-content A→B→A versions remain distinct. Concurrent independent fields merge. Failed cross-device merges automatically keep both inputs as ordinary source-labeled pages with shared origin records; use sync retained to inspect them. Same-device stale writes fail with saveFailed=true and recovery/nextStep: re-read, compare and deliberately resolve, or abandon the attempted edit. Restoring an old page creates a new commit and syncs normally.",
      "Invitations expire and are revocable; one link allows unlimited accounts to register and join. Repeated acceptance does not duplicate membership or change an existing role; a removed member cannot reuse a previously accepted link. Signing into an existing server account reuses that identity. Removing a local connection retains content and does not delete the server project. Account switching is restricted to the project's same server; other-server same-ID projects receive separate local IDs.",
    ],
    commands: [
      "showai sync status --json",
      "showai sync connect --url SERVER_URL --account ACCOUNT --password-file PRIVATE_FILE --json",
      "showai sync connect --url SERVER_URL --account ACCOUNT --password-file PRIVATE_FILE --registration-key-file KEY_FILE --view register --json",
      "showai sync default --connection CONNECTION_ID --json",
      "showai sync projects --connection CONNECTION_ID --json",
      "showai sync attach PROJECT --connection CONNECTION_ID --json",
      "showai sync join --url INVITE_URL --connection CONNECTION_ID --json",
      "showai sync subscribe REMOTE_PROJECT --connection CONNECTION_ID --json",
      "showai sync account LOCAL_PROJECT --connection CONNECTION_ID --json",
      "showai sync run --project LOCAL_PROJECT --json",
      "showai sync retained LOCAL_PROJECT --json",
      "showai sync dashboard --connection CONNECTION_ID --project REMOTE_PROJECT --json",
    ],
    input: {
      retained:
        "Shared origin records contain originalPath, both source accounts/devices/revisions and visible page IDs. Cross-device conflicts continue synchronizing after preserving both inputs.",
    },
  },
  history: {
    purpose:
      "Inspect attributed content history, search full content, merge drafts and restore exact versions safely.",
    rules: [
      "New empty libraries use versioned storage. Existing libraries require reviewed import; preserve original files and mark old checkpoint times/actors/order unknown.",
      "Retain the full page hash, resource revision and stable node IDs. Save/apply requires both base-hash and base-revision. Reuse operation-id only for an identical request.",
      "Abandoning App changes archives the current window's active unsaved draft generation and loads the current saved file. Other windows' newer draft generations, other devices' content and formal history remain. Adopting external disk edits must pass validation; an import failure leaves the conflict unresolved.",
      "History preview/export uses the captured reader and exact component dependencies. Restore creates a new attributed commit; simultaneous changes require another review.",
      "External package files recover into local editable drafts before saving a new immutable version. Space cleanup preserves formal history, unresolved conflicts and live drafts.",
    ],
    commands: [
      "showai history list --project PROJECT --page PAGE --session ACTUAL_SESSION --json",
      "showai history compare --project PROJECT --page PAGE --before REVISION --after REVISION --json",
      "showai history read PAGE --project PROJECT --revision REVISION --view html --out historical.html --json",
      "showai history merge PAGE --project PROJECT --base-revision BASE --input draft.showai.json --json",
      "showai history restore PAGE --project PROJECT --revision REVISION --base-revision CURRENT_REVISION --json",
      "showai search --query TEXT --project PROJECT --json",
      "showai history conflicts --project PROJECT --json",
      "showai history recover-package CONFLICT_ID --project PROJECT --json",
      "showai library stats --json",
      "showai library cleanup-plan --json",
    ],
  },
  reading: {
    purpose:
      "Read the same Page through structured data, rendered pixels or interactive HTML, preserving one source identity.",
    rules: [
      "Default to structured JSON for content/data edits, or format markdown for readable prose and component data. detail outline returns stable IDs before selecting blockIds. A partial document is a projection; reread the full Page before saving it.",
      "Use image for styling, layout, clipping and selected/hover states. Use html for browser accessibility/DOM and actual interactions. Retain pageId, hash, componentRefs, viewport, theme and actions to compare the same source version. expectedHash rejects stale captures.",
      "Image/html reads render the bundled reader in an isolated browser and return an artifact path plus .read.json metadata. MCP image reads also return PNG pixels. They require Chrome/Edge/Chromium or SHOWAI_BROWSER_EXECUTABLE; no browser is downloaded implicitly. Structured reads without computed readers work without a browser; rendered false explicitly requests raw source only.",
      "Components declaring manifest.reader=readData export a synchronous readData(props) JSON model, evaluated only in their browser sandbox. computed distinguishes derived fields from source props. Components without this contract retain raw data; do not invent derived values. Outline reading does not load component runtimes.",
      "actions target one selector or role/name, optionally within blockId. Supported types are hover, click, fill, select, check, uncheck and drag (dx/dy pixels). Missing or ambiguous targets fail visibly. Supply actions as a replayable sequence in --state; use the same viewport when comparing.",
      "Reading interactions explore view state. draft true enables component editing only in the generated preview, including drag and forms; computed.props contains resulting temporary data. Apply intended source changes separately with page_apply/current baseHash. Reading never commits preview edits to the Page.",
      "After visual changes inspect an image; after interaction changes exercise HTML actions. Rendered reading of an existing Page uses its stored pinned components. Rebuild and import changed component source as a new immutable version before replacing its reference.",
    ],
    commands: [
      "showai pages read PAGE --project PROJECT --json",
      "showai pages read PAGE --project PROJECT --detail outline --json",
      "showai pages read PAGE --project PROJECT --blocks NODE_ID --format markdown",
      "showai pages read PAGE --project PROJECT --view image --theme dark --width 1000 --height 900 --base-hash HASH --out ./preview.png --json",
      "showai pages read PAGE --project PROJECT --view html --state reading-state.json --out ./preview.html --json",
      "showai pages read PAGE --project PROJECT --rendered false --json",
    ],
    input: {
      view: "html",
      viewport: { width: 1000, height: 900 },
      theme: "light",
      draft: false,
      actions: [
        {
          type: "hover",
          blockId: "gantt",
          role: "button",
          name: "查看 交互与视觉设计，2026-10-08 至 2026-10-12，40%",
        },
      ],
    },
  },
  workspace: {
    purpose:
      "Resolve a ShowAI project from the host project directory, shared across Agent sessions.",
    rules: [
      "Storage defaults to ~/.showai. --home specifies the content library directory; SHOWAI_HOME supplies it through the launch environment.",
      "A user-specified --project takes priority. Otherwise projects current resolves or creates the project for the host directory. Session bindings and the number of projects in the library do not select the destination.",
      "--source-directory is the exact host project directory. Without it, use cwd's nearest Git root, or cwd outside Git. Canonical real paths identify directories. An archived directory project requires restoration or an explicit project.",
      "Page, component, template and MCP commands use the same directory default when --project is omitted. Directory resolution is serialized so concurrent sessions create only one project.",
      "Ordinary reports default to one Page, organized with sections, regions and nested containers. Separate resource pages and site export follow an explicit website or multi-document request.",
    ],
    commands: [
      "showai projects current --json",
      "showai projects current --source-directory /absolute/host-project --json",
      "showai projects current --project PROJECT --json",
      "showai pages list --json",
      "showai projects create --name 'Independent project' --json",
    ],
  },
  authoring: {
    next: "showai guide containers --json",
    purpose:
      "Create or revise page content without overwriting edits made by the user or another Agent.",
    rules: [
      "Read the page and retain its hash, revision and stable block IDs. Versioned diffs use the preceding revision; legacy snapshots use the preceding hash.",
      "Default to structured reading. Use guide reading for image checks and browser interaction checks; use the full source Page/current hash for writes.",
      "Save/apply requires --base-hash and, when reading returns revision, --base-revision. Same-device CONFLICT with saveFailed=true means the save failed: follow recovery/nextStep, compare the latest version with your original baseRevision, resolve and save or abandon your attempted edit. Never just refresh the hash and overwrite with the unchanged document. Cross-device conflicts may return a source-labeled copy with a new document.id and retainedSyncConflicts; use that returned ID afterwards. Reuse --operation-id only for the same request; --message and --group describe its purpose and editing group.",
      "New resources default to a Page surface. Page and Board containers nest recursively in artifact v3. Use guide containers for structure; query component schemas when adding components.",
      "Keep an ordinary report in one resource page, with sections, navigation and optional nested containers. Continue revisions in that same page; create multiple resource pages only for a user-requested website or separate documents.",
    ],
    commands: [
      "showai pages create --project PROJECT --title 'Research result' --json",
      "showai pages create --project PROJECT --input page.showai.json --json",
      "showai pages read PAGE --project PROJECT --json",
      "showai pages diff PAGE --project PROJECT --since PREVIOUS_REVISION --json",
      "showai pages apply PAGE --project PROJECT --input operations.json --base-hash CURRENT_HASH --base-revision CURRENT_REVISION --json",
      "showai pages save PAGE --project PROJECT --input page.showai.json --base-hash CURRENT_HASH --base-revision CURRENT_REVISION --json",
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
  containers: {
    purpose:
      "Create native Page and Board containers that can nest, expand and share one editable source.",
    rules: [
      "Page and Board are discoverable native components in the same component catalog as Markdown, images and charts. Read their guides, schemas and examples; use component.insert with kind page or board. Native containers retain a surface node in the shared content tree and do not use a widget data wrapper.",
      "New resources use artifact version 3. The root and nested containers are {type:'surface',attrs:{id,kind:'page'|'board',name},content:[...]}. New resources default to Page; --kind board creates an empty Board.",
      "Page lays out its children in tree order and uses normal vertical reading. Board places its children in a local coordinate space and owns its own pan/zoom. Regions are flow/grid/free layout groups; they do not create another viewport.",
      "The parent owns each child's outer frame in document.layout[nodeId]: {x,y,width,height?,heightMode?}. Surface heightMode is fixed or auto; auto is only for Pages. Board frames remain bounded even when internal content extends far away. Root nodes have no parent frame.",
      "document.surfaceViews[surfaceId] stores {initial,saved:[{id,name,targets}],readingOrder}. Every target must belong to that surface. Page order follows the content tree. Current cameras, scroll, selection and expansion are personal state and never enter content hashes.",
      "Use component.insert with kind, data and optional parentId for catalog components. surface.create with kind, optional name/nodeId/parentId remains available for explicit container construction; surface.wrap wraps nodeId (or the root) in a new Page or Board while retaining all original identities. Use block.insert/move/remove/text.set for content and surface.layout.set for frames. surface.view.save/remove and surface.reading-order.set accept optional surfaceId.",
      "Drawings live inside Boards: {type:'drawing',attrs:{id,name,tool:'pen'|'rectangle'|'ellipse'|'arrow',color:'#252629',strokeWidth:2.5,extent:[width,height],points:[{x,y},...]}}. Points are local to their frame; frame position is in layout. Keep shapes inside a Board when inserting them into a Page.",
      "Board frames may include rotation in degrees (-360 to 360) for drawings other than arrows and for images. Page, Board and interactive widgets stay upright. Nonzero rotation requires an explicitly positioned child of a Board or free-layout region. Optional contentSize:{width,height} is a measured content-size hint, not a CSS height; preserve it when reading, never invent it. It is used only at the matching frame width and refreshed by real layout during authoring. Reading alone does not save measurements.",
      "An arrow may add attrs.bindings:{start?:{targetId,anchor:{x,y}},end?:{targetId,anchor:{x,y}}}. Anchors range from 0 to 1 in the target's unrotated frame. Targets must be framed siblings of the arrow under a Board or free-layout region, and cannot be arrows. Flow/grid layout cannot supply endpoint coordinates. Core resolves stored points after target layout changes. Removing or reparenting a target detaches the affected endpoint at its last stored position; moving an entire native surface preserves its internal relationships. Changing a free region to flow/grid detaches bindings on its direct arrow children and clears direct child rotations. Nested Boards/free regions retain their own internal geometry. Arrows remain drawing nodes arranged by the new layout; undo restores the prior geometry.",
      "surface.layout.set on an arrow alone detaches its bindings. Put the arrow and its transformed targets in the same operations batch to retain their internal bindings. A no-op frame update does not detach. Explicit full-document writes keep supplied bindings authoritative; clear a binding to make that endpoint free. Template copies remap internal binding IDs, and partial exports detach references to omitted targets. Validate the actual rendered result after content-size changes.",
      "Inline containers are owned subtrees in one resource. Expanding edits the same node; it does not create a new page or reference another file. resource.parentId is a project folder id; operation.parentId is a content-container id.",
      "Legacy v1 documents adapt to Page, v2 whiteboards retain Board placement. surface.upgrade migrates explicitly with a base hash. First managed saves preserve exact originals and existing snapshots. Never downgrade a stored resource's model version.",
      "Template application preserves container kinds. Insertion into an existing resource adds the template root as a module and remaps all node, layout and view references. Exports and --blocks selections retain necessary container ancestors.",
    ],
    commands: [
      "showai pages create --project PROJECT --kind page --title 'Report' --json",
      "showai pages create --project PROJECT --kind board --title 'Workspace' --json",
      "showai pages apply PAGE --project PROJECT --input operations.json --base-hash HASH --base-revision REVISION --json",
      "showai template apply TEMPLATE --project PROJECT --page PAGE --parent SURFACE_ID --base-hash HASH --base-revision REVISION --json",
    ],
    input: {
      operations: [
        { type: "surface.upgrade" },
        {
          type: "surface.create",
          kind: "board",
          nodeId: "analysis",
          name: "Analysis",
        },
        {
          type: "surface.create",
          kind: "page",
          parentId: "analysis",
          nodeId: "evidence",
          name: "Evidence",
        },
        {
          type: "surface.layout.set",
          nodeId: "analysis",
          layout: { x: 0, y: 0, width: 800, height: 460, heightMode: "fixed" },
        },
        {
          type: "surface.view.save",
          surfaceId: "analysis",
          view: { id: "reading", name: "Evidence", targets: ["evidence"] },
          initial: true,
        },
      ],
    },
    next: "showai guide document --json",
  },
  whiteboard: {
    purpose:
      "Board layout and drawing use the shared recursive container model.",
    rules: [
      "New content defaults to Page. Board is an explicit container kind and can be embedded at any container level. Read guide containers for the complete v3 schema, ownership and operations.",
    ],
    commands: [
      "showai guide containers --json",
      "showai pages create --project PROJECT --kind board --json",
    ],
    next: "showai guide containers --json",
  },
  document: {
    purpose:
      "Read the page JSON format only when authoring document blocks directly.",
    rules: [
      "This guide describes rich-text payloads inside regions and legacy v1 sources. New Page and Board resources use version 3; see guide containers. Explicit legacy documents remain compatible inputs.",
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
      "catalog list and public catalog list return every matching name, description and scenario by default, with IDs, scopes and available revision identities for detail lookup. Omit query, limit and cursor to discover the full accessible catalog. Explicit limit (1–50) opts into pagination with nextCursor; retain the same limit/query/scope for subsequent pages. Restart without a cursor if the catalog changed.",
      "Scopes are builtin, global, published and project. Shared scopes are immutable; author changes in an explicitly selected project.",
      "List entries contain names, descriptions and scenarios plus lookup identities; effects and repeated per-item commands are excluded. describe defaults to summary, where component effects are also available. Neither list nor summary includes schema, default data, page body or code.",
      "Views: guide for usage, schema for props, examples for presets, dependencies for exact references, source for original code/template definition, full for all descriptive metadata. full still excludes source and executable runtimes.",
      "Use the Markdown component (kind text) for headings, paragraphs, lists, quotations, code blocks, dividers and LaTeX formulas together in one content string. Inline math accepts $...$ or \\( ... \\); display math accepts $$...$$ or \\[ ... \\]. Code remains literal. Image and table remain independent components with dedicated editing and appearance features. Toggle and other interactive/custom components use their own kinds and data; request schema/examples before authoring.",
      "Builtins expose an editable starting source. Read --view source, choose a new manifest id/version, then save it in the selected project.",
      "Video, Audio, PDF and References are built-in components. Query their schemas/examples. File components accept src as an http/https URL or a matching base64 data URI; local upload is limited to 6 MB per file and the whole page to 10 MB. Online playback/loading needs network access (PDF URLs also need CORS); offline exports require embedded files and video posters. Custom component sandboxes accept embedded files only. References stores id/title/authors/year/venue/doi/url/note; Markdown links such as [1](#ref-paper-id) target a stable item id.",
      "Compose in code with named imports from showai:components (Markdown, Image, Table, Toggle, Chart, Database, Metrics, Playground, Gallery, Bookmark, Video, Audio, PDF, References). Import custom children from showai:component/ID after declaring their exact refs in manifest.dependencies. Pass data, readOnly and onChange to each child. Compiled parents contain their children; promotion/publication copies the source dependency closure.",
      "Component source shows the entry file and a file index. Add --file PATH for a particular file or --file '*' for the complete original package.",
    ],
    commands: [
      "showai catalog list --kind component --project PROJECT --json",
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
      "For derived values, declare manifest.reader=readData and export synchronous readData(props) JSON (up to 64 KiB) from the entry. Join computed fields back to source by stable IDs and mark derived fields. It executes in the component browser sandbox; do not read files or call services. Import a new version after adding or changing the contract.",
      "Describe input data, reader actions and resulting state before choosing an implementation. Search component summaries first; read source only for the chosen component being changed.",
      "A local package contains manifest.json, props.schema.json and its React entry. The entry receives {data, onChange, readOnly}; onChange persists valid edits, while reading interactions keep source content unchanged.",
      "Interactive components can import GestureBoundary from showai:components and set axes to x, y and/or zoom to own those gestures. Do not intercept unneeded axes. Native scroll regions and iframe contents already own their inputs.",
      "manifest needs id, name, version, description, scenarios, entry, defaultData and examples. Default data and every example must pass the schema.",
      "Use React, package-local imports or showai:components, including Flowchart. Custom children use showai:component/ID with exact manifest.dependencies refs. External npm libraries belong in the installed ShowAI runtime, not the skill package.",
      "Import into the selected project, use it in a real page and check the main interaction in desktop and exported HTML. New versions are immutable; shared promotion is explicit.",
    ],
    commands: [
      "showai catalog list --kind component --project PROJECT --json",
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
      "showai pages diff PAGE --project PROJECT --since PREVIOUS_REVISION --json",
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
      "Applying a template creates a resource with the template container kind. --page with --base-hash inserts its root as a module into an existing container. Composition expands referenced templates and preserves exact dependency revisions.",
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
      "Deliver a page, selected components/regions or a static website without carrying the authoring workbench.",
    rules: [
      "For partial display, add --blocks ID,ID to html or inline export. IDs are page node attrs.id from pages read, not catalog component IDs. A selected container includes its entire subtree; multiple selections keep page order and shared ancestors without duplication.",
      "Partial exports default to reading presentation, hide the page title, and include only selected content, necessary ancestor containers and referenced runtimes. Use --presentation spatial explicitly to retain whiteboard positioning. Unknown, empty or duplicate IDs and site selections are rejected.",
      "After saving edits to the complete page with the current hash, show only the relevant blocks when the user asks for a focused result or an automation updates progress. Export selection does not change the stored page. The companion .showai.json is a partial projection: do not use it to replace the full page.",
      "Full-page presentation defaults to spatial: all regions share an infinite whiteboard. --presentation reading renders responsive reading order; full-page exports retain the full v2 layout and views in editable source.",
      "bundled is the default: reader, content and exact component runtimes are included. Raster images must be embedded for offline delivery.",
      "remote requires previously verified published component locators and network access when reading. It does not implicitly upload or publish components.",
      "inline must use bundled components and fit the host's size limit. Rendering a conversation fragment requires a supported host display surface; MCP alone does not supply one.",
      "After creating or revising a ShowAI page, export inline and include the host's actual rendering reference in the final reply by default, including content-organization and standalone-page tasks. In Codex use the current visualize fragment/path/output-reference contract with the returned absolute path; ShowAI defines this delivery step. Opening an app or preview panel and linking a file are supplementary delivery actions. Omit the conversation preview only when the user explicitly requests save-only, file-only, panel-only or background execution.",
      "HTML and inline export compile the selected native component registrations and dependency closure from the software's reader source archive. G2 includes selected drawing functions and their required libraries. Site export shares the union across pages. runtime info.readerCompilation identifies page-dependencies or prebuilt compatibility mode. Try complete inline first, and judge the 1 MB limit by final compressed bytes. If still oversized, export meaningful blocks and link complete HTML. Preserve one source page.",
      "A whole-project site omits archived pages. Existing deliverables require explicit --overwrite. Export outside authoring sources or into the selected project's exports directory.",
    ],
    commands: [
      "showai export --project PROJECT --page PAGE --format html --components bundled --out ./report.html --json",
      "showai export --project PROJECT --page PAGE --format inline --components bundled --out ./report-inline.html --json",
      "showai export --project PROJECT --page PAGE --blocks PROGRESS_BLOCK_ID --format inline --out ./progress-inline.html --overwrite --json",
      "showai export --project PROJECT --page PAGE --blocks CHART_BLOCK_ID,METRICS_BLOCK_ID --format html --out ./selected.html --json",
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
