import { COMPONENT_PARAMETER_CAPABILITIES } from "../portable/component-parameters.mjs";
import { z } from "zod";
import { componentDocumentationSchema } from "../components/custom/documentation";
import {
  componentAuthoringIndexSchema,
  componentAuthoringGuideSchema,
} from "../components/custom/authoring";

export const GUIDE_TOPICS = [
  "presentation",
  "integration",
  "workspace",
  "authoring",
  "reading",
  "document",
  "datasets",
  "whiteboard",
  "containers",
  "catalog",
  "component",
  "templates",
  "template-extraction",
  "versions",
  "recovery",
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
  presentation: {
    purpose:
      "Mandatory system presentation baseline and staged template instructions.",
    rules: [
      "Start native Board understanding with board_read: a full image when small, otherwise overview plus 1600×1600 windows with 200-pixel overlap. Each image carries its pixel size, Board bounds and imageToBoard affine transform; tile indexes preserve native IDs across overlaps. maxImages limits a batch to eight; coverage.nextCursor continues on the same snapshotId. Empty windows are omitted with occupiedRanges and emptyTiles reported; explicit tile reads can still inspect them.",
      "board_read freezes the bundled reader's rendered content and complete source in one 30-minute snapshot. Rendered nested Page scrolling and Board cameras can be supplied in state. This is a saved-source rendering unless draftDocument is explicitly supplied; it does not implicitly capture the live editor. origin, sourceHash, componentRefs, state, warnings and currentSourceChanged identify that distinction. Reading never writes content. SNAPSHOT_EXPIRED requires a new capture.",
      "For Board detail supply snapshotId with mode tile and tileIds, mode region with tileId plus pointPx or rectPx, or mode element with nodeId and detail source/image/both. Pixel selectors use the original tile's resolution; scale changes only the requested detail image resolution. tileId restricts an element to that image; imageScope tile clips its detail crop. Source retains exact drawing points, Page text, component props and bindings. Large element images paginate with cursor; use smaller regions if a requested detail exceeds 2560 pixels per side.",
      "The Board pageIndex enumerates nested native Pages including clipped/offscreen content, with pageCoverage.nextOffset. Read a Page's complete original subtree through page_read({pageId,snapshotId,blockIds:[nodeId],rendered:false,response:source}); pageId remains the containing resource, nodeId identifies the nested Page. Omit blockIds to read the entire resource. mode source returns the captured Board subtree with parentPath/layout/surfaceViews/externalRefs. Partial sources are not full replacement documents. Before editing reread the current complete Page without snapshotId and keep its current hash/revision.",
      "Read guide presentation for the mandatory baseline. The four stages are intent (reader brief), material (source notes), logic (multi-level presentation plan) and design (scene-by-scene design draft); authoring implements the draft and review checks the saved Page against it. Read one current-stage guide at a time. Select task templates with template_context; template_guide adds their exact-version instructions and component references.",
    ],
    commands: [
      "showai boards read PAGE --project PROJECT --json",
      "showai boards read PAGE --project PROJECT --snapshot SNAPSHOT --mode tile --tiles T1,T2 --json",
      "showai boards read PAGE --project PROJECT --snapshot SNAPSHOT --mode element --node NODE --state detail-options.json --json",
      "showai pages read PAGE --project PROJECT --snapshot SNAPSHOT --blocks PAGE_NODE --rendered false --json",
      "showai guide presentation --json",
      "showai template context --project PROJECT --templates paper-explainer --json",
    ],
  },
  integration: {
    purpose:
      "Use common ShowAI capabilities across harnesses, choosing display and synchronization independently.",
    rules: [
      "Discover actual capabilities with runtime info (CLI) or showai_capabilities (MCP). Harness names do not prove inline, MCP Apps, shell or filesystem support.",
      "Public components/templates and customization do not require a personal project or synchronization. public list/describe and render are the CLI equivalents of public_catalog_list/describe and render_document.",
      "render input is {document?,templateId?,title?,componentSources?}; supply document or templateId. componentSources use the editable manifest/schema/source/files/assets contract from guide component. Rendering returns HTML, inline and source plus savedToProject=false/synchronized=false.",
      "For persistent work use the selected local project or OAuth-authorized remote project. Remote tools require projectId from projects_list and never accept local filesystem paths. CLI and project-bound stdio use the actual local project.",
      "Remote writes pull before operating and push afterward. Inspect isError, ok and synchronization.state/error/remoteHead. A retained local result with failed sync must not be reported as published. Cross-device conflicts retain both versions and may return a new page ID; same-device conflicts require explicit resolution.",
      "Display is optional: MCP Apps uses show_component/render_document/page_present; other inline hosts use their actual rendering contract. show_component shows one to five components in the conversation without saving them. Text-only hosts can write shared projects and return a receipt; the user sees synchronized results in ShowAI.",
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
      "Connect project-scoped servers, inspect synchronization, join invitations and synchronize current content across devices.",
    rules: [
      "Servers manage projects with admin, editor and viewer roles. Identity and tokens are per server; each local project binds one server project and one account connection. There is no server administrator or owner role.",
      "Settings → 服务器与同步 configures connections, the default storage for future projects, project accounts, invitation acceptance and the embedded project Dashboard. Existing local projects are attached explicitly; default changes do not upload existing projects.",
      "Use real connection/project IDs returned by status/projects. Credentials come from password-file/token-file/registration-key-file or SHOWAI_SERVER_PASSWORD/SHOWAI_SERVER_TOKEN/SHOWAI_REGISTRATION_KEY. Outputs omit connection tokens. view register creates a password account; configured deployment currently supports password and token authentication.",
      "The running desktop/browser workbench synchronizes in the background. A standalone Agent can explicitly invoke sync run after local writes; disconnected edits remain on disk. A local save is not proof of successful remote publication: inspect project status/error and remoteHead.",
      "Project transfer contains only current page data, source/compiled dependencies and assets. Each device retains one synchronization baseline for merging concurrent edits. Preview and export generate HTML on demand. Device paths and directory bindings remain local. Never upload the whole content library to share one project.",
      "Viewer/revoked connections cannot commit project edits. Concurrent independent fields merge. Failed cross-device merges automatically keep both inputs as ordinary source-labeled pages with shared origin records; use sync retained to inspect them. Same-device stale writes fail with saveFailed=true and recovery/nextStep: re-read, compare and deliberately resolve, or abandon the attempted edit.",
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
  recovery: {
    purpose: "Resolve retained unsaved drafts and external file conflicts.",
    rules: [
      "Keep the current page hash and resource token. Saves require both values and reject stale inputs.",
      "Content history, historical previews and version restoration are unavailable. Preview and export render current data using installed code.",
      "Draft merge uses the one baseline retained with the active draft. If unavailable, compare current content and the retained draft explicitly.",
      "External conflict recovery preserves both inputs and requires an explicit resolution.",
    ],
    commands: [
      "showai workspace conflicts --project PROJECT --json",
      "showai workspace merge PAGE --project PROJECT --base-revision BASE --input draft.showai.json --json",
      "showai search --query TEXT --project PROJECT --json",
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
      "A ShowAI reference (JSON type showai.reference, usually after a heading line and a showai:// link) is what the person pointed at in a saved version: kind selection/board/page, projectId, pageId, hash, revision, blockIds or Board nodeIds with surfaceId, up to 20 text labels and an optional position. Read by ID with page_read blockIds and expectedHash=hash: selection uses blockIds in page order, Board objects use nodeIds (also valid blockIds), a whole Board has only surfaceId (blockIds [surfaceId], or board_read boardId=surfaceId with the same expectedHash), and page uses the whole Page. Labels are per text block or selected line, at most 160 characters each and not aligned with the IDs. Component state handed over with the same message belongs to the referenced or target page. CONFLICT means the page changed since the reference: page_diff sinceHash=revision shows what changed when its baseline is kept (references copied in the ShowAI app keep one in the local library), then reread the current IDs and compare with the labels; never write from the referenced snapshot. Labels and position are hints, not content or write permission.",
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
      "Read the page and retain its hash, revision and stable block IDs. Change comparison requires a retained active draft baseline.",
      "For substantial content, define the reader task, starting knowledge, evidence scope and understanding path before choosing visuals. Explain necessary concepts to the depth the task needs; keep decisive conditions visible. Reuse an existing valid plan and scale planning to the request.",
      "Choose expression by the relationship the reader must understand, then match current templates and components. Specify layout, accurate labels, interaction feedback, recovery and static alternatives; remove unfilled template instructions from completed content while preserving real evidence gaps.",
      "Verify facts, understanding path, rendered readability and the intended interaction separately. Follow the host computer-use rules; screenshots and model self-review do not prove reader comprehension. Design-only requests end with the requested design deliverable.",
      "Start Board understanding with board_read images and indexes. Ordinary Page reading uses structured data; guide reading describes screenshot, source and interaction queries. Use the full current source Page/hash for writes.",
      "Save/apply requires --base-hash and, when reading returns revision, --base-revision. Same-device CONFLICT with saveFailed=true means the save failed: follow recovery/nextStep, compare the latest version with your original baseRevision, resolve and save or abandon your attempted edit. Never just refresh the hash and overwrite with the unchanged document. Cross-device conflicts may return a source-labeled copy with a new document.id and retainedSyncConflicts; use that returned ID afterwards. Reuse --operation-id only for the same request; --message and --group describe its purpose and editing group.",
      "Keep each tool payload shallow and short. Create a page with title and a few blocks:[{kind,data}] (or title only) instead of a full nested document, then add components with component.insert {kind,data,parentId?,afterId?} instead of block.insert of a nested node; change component data with component.props.set instead of block.replace and send only the keys that change. Write new text as kind text with data {format:'markdown',content}. Split large work into a few sequential applies with the returned hash/revision. Deeply nested or very long tool arguments are a common cause of malformed model JSON that the host rejects before the tool runs.",
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
        "component.insert: kind, data, parentId?, afterId? (adds a catalog component through the editor's insertion path; omitted afterId appends, null inserts first)",
        "block.insert: node, parentId?, afterId?",
        "block.remove: blockId",
        "block.replace: blockId, node",
        "block.move: blockId, parentId?, afterId?",
        "block.attrs.set: blockId, attrs (merges the listed attributes; null removes one; never include id)",
        "diagram.insert: nodes, edges?, parentId?, direction?, origin?, spacing? (labelled Board shapes and bound arrows in one step; see guide whiteboard)",
        "diagram.arrange: nodeIds, direction? (re-lays out existing connected Board objects along their arrows; see guide whiteboard)",
        "component.props.set: blockId, props (replaces only the listed top-level data keys of an existing component; custom components keep componentId, version and integrity; on a block bound to a dataset it writes the dataset, see guide datasets)",
        "component.binding.set: blockId, binding (binds a component block to a project dataset; see guide datasets)",
        "component.binding.remove: blockId, keep? ('snapshot' keeps the shown props in the block, 'local' keeps only its own values)",
      ],
    },
  },
  datasets: {
    purpose:
      "Let blocks on several pages read and write one shared value (a dataset) instead of copying data between pages.",
    rules: [
      "A dataset is a project file (datasets/ID.json) with its own hash and revision; it holds one JSON value. A component block binds to it through data.$binding; the page stores only the binding and the block's own values, so dataset edits never change the page hash and page conflicts never involve the shared data.",
      "props binding {dataset, props:{path?, local?:[keys]}}: the dataset value (or the object at path) supplies the component's top-level props, except the local keys, which each block keeps for itself (e.g. title, view). Share an existing block with dataset_create fromBlock {pageId, blockId, baseHash, local?}; a custom component's props schema then guards every write. Bind another block to the same dataset with component.binding.set to show the same data elsewhere.",
      "collections binding {dataset, collections:[{key, into, from, where?, fields?, derived?, defaults?, label?}]}: records along from (e.g. 'objectives[*].keyResults[*].tasks[*]') appear as items of the array prop into (e.g. a database's rows), after the block's own items. Item ids are KEY:RECORD_ID. fields map shown fields to the record's own fields and write back (string, or {from, map?:{shown:stored}, otherwise?, empty?:'remove'|'keep'}; use empty:'remove' for optional dates). derived fields are read-only: a reference ('../title' climbs one level), {value}, {template:'… {../title}'} or {lookup:'areas', by:'../area', field:'name'}. Other fields (and defaults) are stored with the block per item in $binding.overlay. Several collections can fill the same into. Manual items of the block stay untouched.",
      "Records keep stable ids. Writes address them by id path, e.g. objectives[id=o1].keyResults[id=k1].tasks[id=t1].due or [\"objectives\",{\"id\":\"o1\"},…]. Lists without ids are replaced as one value, so give list items ids when several writers edit them.",
      "Concurrency: every write carries the value it started from. Changes to different records or fields merge automatically; a field changed differently by two writers is a conflict: nothing is written, CONFLICT returns details.conflicts [{path, base, mine, theirs}], and the editor keeps the person's version visible until they choose. Never resolve by rewriting the whole value from an old read.",
      "Check showai_capabilities.datasets.protocol is showai-datasets-v1 first. Read with page_read (bindings lists each bound block's dataset, hash, resolved props and in sources the record path of each mapped item; kept in response source, omitted in receipt) or dataset_read; both remember the read so later writes merge. page_apply component.props.set on a bound block takes props as shown (e.g. rows including mapped rows) and writes mapped fields to the dataset and other fields to the block in one save; removing a mapped row or changing a derived field is rejected. Pass datasetBases {datasetId: hash} when you read in another session. dataset_apply changes the value directly with set/remove/insert/move operations and the baseHash from your read.",
      "External files: dataset_link keeps a dataset's value in a file outside the content library instead of the project. .json holds any JSON value; .csv/.tsv hold a table as {columns, rows} (first row names the columns; cells read back as text, numbers or true/false; give rows an id column so writes address them, e.g. rows[id=m1].date, and bind with collections from 'rows[*]'). Without datasetId it creates a dataset from an existing file (or writes value into a new file); with datasetId it moves the dataset's value into a new file (use 'dataset'), replaces it with an existing file (use 'file'; required when both hold data), or links this device's copy of an external dataset's file. Linking never overwrites an existing file. path null copies the current content back into the library and stops reading the file, which is kept; dataset_delete also keeps the file.",
      "An external dataset is read from its file on every read and written back on every write (atomic replace, keeping the file's indentation, line endings and quoting); changes made to the file elsewhere appear in open windows and merge with writes made from an earlier read like any other writer. The library stores only the dataset's name, schema and source format and file name; the absolute path is linked per device, so a synchronized or shared project shows SOURCE_UNAVAILABLE (details.source with format, name and path if linked) on devices that have not linked their own copy, and dataset_list marks it source.available false. Report that to the person and link the file only when they name it; never guess a path. Hosted (remote) connections cannot link files.",
      "Exports, page images and board_read render a snapshot of the current shared data. An export that would embed data from external files stops with CONFIRMATION_REQUIRED and details.externalSnapshots {datasets:[{name, path, fileBytes, snapshotBytes, blocks, available}], snapshotBytes} and writes nothing: tell the person what would be embedded and how large it is (the export no longer updates with the file and its readers see the data), and repeat page_export with externalData 'embed' only after they agree. available false means the file is unreadable and its blocks would be exported without data. component.binding.remove keep 'snapshot' detaches a block with a copy of what it shows. dataset_delete refuses while blocks still bind to the dataset and lists them; deletion cannot be undone in the app, so confirm with the person first. A conflict shown in the workbench stays in that window's draft until the person chooses; Agents only see saved values. Moving a page to another project keeps its bindings pointing at the original project (binding.project).",
    ],
    commands: [
      "showai datasets list --project PROJECT --json",
      "showai datasets read DATASET --project PROJECT [--path 'objectives[id=o1]'] --json",
      "showai datasets create --project PROJECT --name 'OKR' --input from-block.json --json",
      "showai datasets apply DATASET --project PROJECT --input operations.json --base-hash HASH --json",
      "showai pages apply PAGE --project PROJECT --input bind.json --base-hash HASH --base-revision REVISION --json",
      "showai datasets link --project PROJECT --name 'Schedule' --file /abs/path/schedule.csv --json",
      "showai datasets link DATASET --project PROJECT --file /abs/path/new-data.json --use dataset --json",
      "showai datasets link DATASET --project PROJECT --embed --base-hash HASH --json",
      "showai export --project PROJECT --page PAGE --format html --out ./page.html --external-data embed --json",
      "showai datasets delete DATASET --project PROJECT --base-hash HASH --json",
    ],
    input: {
      fromBlock: { fromBlock: { pageId: "PAGE", blockId: "OKR_BLOCK", baseHash: "PAGE_HASH", local: ["title"] } },
      datasetOperations: [
        { op: "set", path: "objectives[id=o1].keyResults[id=k1].tasks[id=t1].due", value: "2026-10-24" },
        { op: "insert", path: "objectives[id=o1].keyResults[id=k1].tasks", value: { id: "t9", title: "New task" }, after: "t1" },
        { op: "remove", path: "objectives[id=o2]" },
      ],
      bindDatabase: [
        {
          type: "component.binding.set",
          blockId: "SCHEDULE_DATABASE",
          binding: {
            dataset: "DATASET",
            collections: [
              {
                key: "task",
                into: "rows",
                from: "objectives[*].keyResults[*].tasks[*]",
                where: { field: "due", exists: true },
                label: "全景 · 任务",
                fields: { title: "title", date: { from: "due", empty: "remove" }, done: "done" },
                derived: {
                  project: "../../title",
                  cat: { lookup: "areas", by: "../../area", field: "name" },
                  source: { template: "全景 · {../title}" },
                },
                defaults: { kind: "截止" },
              },
              {
                key: "kr",
                into: "rows",
                from: "objectives[*].keyResults[*]",
                where: { field: "due", exists: true },
                fields: {
                  title: "title",
                  date: { from: "due", empty: "remove" },
                  done: { from: "status", map: { true: "done", false: "todo" }, otherwise: false },
                },
                derived: { project: "../title", cat: { lookup: "areas", by: "../area", field: "name" } },
              },
            ],
          },
        },
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
      "Ordinary catalog components inserted directly into a Board or free-layout region are wrapped in an editable Page. For related components, first create one Page with a known nodeId and insert its children using that Page's parentId; retain drawings and shapes as canvas objects.",
      "Page native outlines are optional attrs.outline on surface(kind=page), updated with block.attrs.set on the Page ID. Configuration: {version:1,enabled:true,source:{mode:'headings',maxLevel:3,overrides?:{[headingId]:{title?,hidden?}}}|{mode:'manual',entries:[{id,title?,nodeId?,children?}]},initialState:'auto'|'expanded'|'collapsed',placement:'auto'|'floating'|'docked',width:220,renderer?:{componentId,version,integrity,props}}. Use exact renderer revisions. Omit renderer for the built-in reading index. Disable with enabled:false; null removes the outline. Scope excludes nested container contents. Reading controls and branch state never write content. Standard/wide/full layouts use actual Page space; full-width outlines float, and narrow Pages use drawers.",
      "A custom outline is a versioned component with manifest.role:'page-outline', pageOutlineProtocol:1 and category:'outline'. Its React entry receives {props,outline,navigate,setBranchExpanded,collapse}; outline is {protocol:1,pageId,items:[{id,title,level,navigable,children}],activeItemId,expandedItemIds,container:{placement,width,height},theme,locale}. navigate(itemId), setBranchExpanded(itemId,boolean) and collapse() are validated host actions, available in read-only readers. Never navigate by DOM access or save state through onChange. The same compiler/schema/versions/sandbox/portable dependency flow applies; attach it to attrs.outline.renderer rather than component.insert. See examples/page-outline-index and examples/page-outline-path and docs/page-surface.md for the protocol.",
      "A Page may set attrs.frameless:true to hide its frame, background and title line while retaining editable content. Set it with block.attrs.set {blockId, attrs:{frameless:true}}; attrs merge into the existing ones and must not include id. The boolean attribute is not valid on Boards or ordinary components.",
      "The parent owns each child's outer frame in document.layout[nodeId]: {x,y,width,height?,heightMode?}. Surface heightMode is fixed or auto; auto is only for Pages. Board frames remain bounded even when internal content extends far away. Root nodes have no parent frame.",
      "document.surfaceViews[surfaceId] stores {initial,saved:[{id,name,targets}],readingOrder}. Every target must belong to that surface. Page order follows the content tree. Current cameras, scroll, selection and expansion are personal state and never enter content hashes.",
      "Use component.insert with kind, data and optional parentId for catalog components. surface.create with kind, optional name/nodeId/parentId remains available for explicit container construction; surface.wrap wraps nodeId (or the root) in a new Page or Board while retaining all original identities. Use block.insert/move/remove/text.set for content and surface.layout.set for frames. surface.view.save/remove and surface.reading-order.set accept optional surfaceId.",
      "Drawings live inside Boards: {type:'drawing',attrs:{id,name,tool:'pen'|'highlighter'|'rectangle'|'ellipse'|'arrow',color:'#252629',fillColor:'none',strokeWidth:2.5,extent:[width,height],points:[{x,y},...]}}. Color and optional fillColor use six-digit hex values; fillColor may also be none and fills rectangles/ellipses. Stroke width is 0.5–40 in local drawing units. Highlighter renders its freehand stroke at 35% opacity; use a wider stroke, e.g. 16. Points are local to their frame; frame position is in layout. Keep shapes inside a Board when inserting them into a Page.",
      "Rectangles, ellipses and arrows may carry attrs.label: plain text up to 2000 characters, newlines allowed, centred and wrapped inside the shape or shown at the arrow's midpoint, drawn in the shape's color. attrs.labelSize sets its font size in Board units (8–160, default 16; the editor offers 14, 16, 22, 30). Put text that belongs to a shape in its label instead of a separate Page. Change it later with block.attrs.set {blockId, attrs:{label, labelSize}}; null removes either attribute. An explicit frame does not grow with its text: check the result with board_read and enlarge the frame with surface.layout.set when needed.",
      "When block.insert adds a drawing, omitted fields are derived: color #252629 and stroke width 2 (pen 2.5, highlighter 16); rectangle and ellipse points and extent from the frame set with surface.layout.set in the same batch; without a frame, the shape gets one sized to fit its label. Freehand strokes and unbound arrows still need points; their extent and frame follow from the points.",
      "Board frames may include rotation in degrees (-360 to 360) for drawings other than arrows and for images. Page, Board and interactive widgets stay upright. Nonzero rotation requires an explicitly positioned child of a Board or free-layout region. Optional contentSize:{width,height} is a measured content-size hint, not a CSS height; preserve it when reading, never invent it. It is used only at the matching frame width and refreshed by real layout during authoring. Reading alone does not save measurements. Optional locked:true protects a frame from pointer moves and resizes in the editor; omit the field to unlock. Preserve it unless the request is to unlock.",
      "An arrow may add attrs.bindings:{start?:{targetId,anchor?:{x,y}},end?:{targetId,anchor?:{x,y}}}. Anchors range from 0 to 1 in the target's unrotated frame; an omitted anchor becomes the edge midpoint facing the other end. An arrow bound at both ends needs no points, extent or frame: Core computes them. Targets must be framed siblings of the arrow under a Board or free-layout region, and cannot be arrows. Flow/grid layout cannot supply endpoint coordinates. Core resolves stored points after target layout changes. Removing or reparenting a target detaches the affected endpoint at its last stored position; moving an entire native surface preserves its internal relationships. Changing a free region to flow/grid detaches bindings on its direct arrow children and clears direct child rotations. Nested Boards/free regions retain their own internal geometry. Arrows remain drawing nodes arranged by the new layout; undo restores the prior geometry.",
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
      "Draw a boxes-and-arrows diagram that people will keep editing on the Board with one diagram.insert operation: {type:'diagram.insert',parentId?,direction?:'right'|'down'|'left'|'up',origin?:{x,y},spacing?:{node?,rank?},nodes:[{id,label?,shape?:'rectangle'|'ellipse',labelSize?,x?,y?,width?,height?,color?,fillColor?,strokeWidth?,name?}],edges:[{id?,from,to,label?,labelSize?,color?,strokeWidth?,name?}]}. It creates native labelled shapes and arrows bound at both ends. parentId names a Board or free-layout region and defaults to the root Board.",
      "Give every node x and y (relative to origin) or none of them. Without positions the nodes are laid out along the edges in the given direction (default right), starting at origin or beside the existing content. Sizes fit each label unless width and height are given. Edge ids default to FROM-to-TO; edges may form cycles. Edges may also point at framed objects already in the same container; only new nodes are laid out. Node ids must be new and become the stored node ids.",
      "Node ids become the stored node ids. Shapes and arrows created this way are ordinary drawings: change them later with block.attrs.set (label, labelSize, colors), surface.layout.set (frames) or block.remove, by stable id. After writing, read the Board with board_read and fix overlaps or text that does not fit; element index items include each drawing's label.",
      "To tidy existing connected objects, send {type:'diagram.arrange',nodeIds:[...],direction?:'right'|'down'|'left'|'up'}. It lays out the listed unlocked, framed objects of one container along the arrows between them (at least one such arrow; listed objects without arrows join the layout), keeps the group's top-left corner, and re-attaches those arrows to facing sides. List shapes and other objects, not arrows. Arrows to unlisted objects stay bound and follow; unlisted objects and unbound arrows stay where they are, so leave out anything that must not move, and check with board_read that the arranged group does not cover it. It uses the same layout as the editor's arrange-along-arrows command.",
      "Use native shapes for sketches, annotations and drafts the reader will rearrange by hand. For a structured diagram the reader explores (steps, branches, sequences, layers), a catalog component such as flowchart, sequence-diagram or layer-diagram is usually clearer.",
    ],
    commands: [
      "showai guide containers --json",
      "showai pages create --project PROJECT --kind board --json",
    ],
    input: {
      operations: [
        {
          type: "diagram.insert",
          direction: "right",
          nodes: [
            { id: "client", label: "Client" },
            { id: "api", label: "API service", fillColor: "#ede9fe" },
            { id: "cache", label: "Cache" },
            { id: "db", label: "Database", shape: "ellipse" },
          ],
          edges: [
            { from: "client", to: "api", label: "request" },
            { from: "api", to: "cache", label: "1 read cache" },
            { from: "api", to: "db", label: "2 on miss" },
          ],
        },
      ],
    },
    next: "showai guide containers --json",
  },
  document: {
    purpose:
      "Read the page JSON format only when authoring document blocks directly.",
    rules: [
      "This guide describes rich-text payloads inside regions and legacy v1 sources. New Page and Board resources use version 3; see guide containers. Explicit legacy documents remain compatible inputs.",
      "A document requires id, title and a doc content node. The store assigns the page identity and stable attrs.id values; retain existing block ids when revising.",
      "Text nodes use {type:'text',text,marks?}; empty paragraphs have content:[] rather than an empty text node.",
      "Headings use attrs.level 1–6. Lists contain listItem children starting with a paragraph. taskList contains taskItem with attrs.checked. Tables contain tableRow then tableCell/tableHeader, each containing paragraphs/blocks.",
      "Links use a link mark with attrs.href. Code uses codeBlock with text children and optional attrs.language. Callout/toggle contain blocks; toggle attrs.title/open configure its heading. A stepper shows ordered steps one at a time: its children are step nodes (1–12), each with attrs.title and any blocks, including widgets. Create it with component.insert kind stepper, then put content into a step with component.insert or block.insert using parentId = that step's id; which step a reader has open is never saved.",
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
      "Component discovery without scope returns all built-ins plus the selected project's components (one recommended revision per id/scope; versions=all lists available package versions); without a selected project it returns built-ins only. Explicit scope global, published or all includes shared resources. Template discovery keeps its existing all-scope default. Keep each returned scope/version/integrity when reading details, including components that share an ID.",
      "List entries contain names, descriptions, scenarios and lookup identities. Each component entry also carries signature: one line derived from its props schema with the data fields and their types, required fields first, nested structures collapsed to {…} and trailing fields to … when the line would exceed 320 characters. Use it to judge fit and prepare data; field meanings, omission behavior and relation rules stay in the guide and parameters views. Effects and repeated per-item commands are excluded. describe defaults to summary, where component effects are also available. Neither list nor summary includes the full schema, default data, page body or code.",
      "Views: guide for the versioned use contract, schema and compact example; development for implementation guidance without code; schema for props, examples for complete presets, dependencies for exact references, source for original code/template definition, full for all descriptive metadata. full still excludes source and executable runtimes.",
      "Use the rich-text component (kind text) for authored text. For new text prefer the shallow data {format:'markdown',content:'## Heading\n\n**Bold** text'}; it is converted into the same richtext tree. Use {format:'richtext',content:{type:'doc',content:[...]}} only for formatting Markdown cannot express, such as text color, highlight modes or alignment. Text marks include bold, italic, underline, strike, code, highlight (attrs.color; attrs.mode: lower by default, or full), link and textStyle (attrs.color/fontFamily/fontSize). Bold, text color and highlight are independent. Paragraph attrs.textAlign supports left/center/right/justify. component.insert creates a native richText node using the same component editor, with stable child IDs for page edits. Legacy widget/text and Markdown/plain strings remain readable and edit into richtext trees. Selection, hover and formatting controls belong to the component. Formulas use mathInline/mathBlock with attrs.latex; code stays literal.",
      "Hover notes explain terms, abbreviations, symbols and formula variables without interrupting the text. In Markdown write [visible text]{note}; the text shows a dotted underline and readers see the note on hover, keyboard focus or tap. Inside any formula write \\note{part}{note}, e.g. $\\note{x_t}{noisy latent at step t} = \\sqrt{\\bar\\alpha_t}\\,x_0$; [$formula$]{note} annotates a whole formula. Notes may contain $...$ math, need balanced braces and hold 1-1000 characters. In richtext trees a text note is the mark {type:'annotation',attrs:{note}}; formula notes stay in latex. The same [text]{note} syntax works in documentation built-ins' inline markup, component titles and descriptions, and chart labels and series names. Custom components import NoteText (text with notes), NoteSvgText (inside SVG) or noteProps(note) (any element) from showai:components.",
      "Builtins expose an editable starting source. Read --view source, choose a new manifest id/version, then save it in the selected project.",
      "Video, Audio, PDF and References are built-in components. Query their schemas/examples. File components accept src as an http/https URL or a matching base64 data URI; local upload and embedded resources allow 64 MiB per decoded file, with 128 MiB per page (unique data URLs); page structure has a separate 16 MiB UTF-8 JSON budget. Component instance structure allows 8 MiB. Artifact JSON and final HTML each allow 256 MiB; the compressed conversation preview allows 1,000,000 bytes independently. runtime capacities exposes the current byte budgets. Online playback/loading needs network access (PDF URLs also need CORS); offline exports require embedded files and video posters. Custom component sandboxes accept embedded files only. To offer a large local original without embedding it, link to it with <a href=\"file:///absolute/path\"> or file:~/path: a reader's click opens the file in the ShowAI workbench player (video, audio, image) or offers to show other files in their folder; the component never receives the bytes, exported HTML only shows the location, and link clicks must bubble (do not stop their propagation). References stores id/title/authors/year/venue/doi/url/note; Markdown links such as [1](#ref-paper-id) target a stable item id.",
      "Compose in code with named imports from showai:components (RichText, Image, Table, Toggle, Stepper, Chart, Database, Metrics, Playground, Gallery, Bookmark, Video, Audio, PDF, References). Render text fields that may carry hover notes with NoteText (or NoteSvgText inside SVG); give any other anchor noteProps(note). Import custom children from showai:component/ID after declaring their exact refs in manifest.dependencies. Pass data, readOnly and onChange to each child. Compiled parents contain their children; promotion/publication copies the source dependency closure.",
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
      "When a component guide returns authoringReference, follow its scoped source-file reference to the versioned production index. Read the original process and selected type/style guides plus inputs before generating new content. These authoring files are part of normal component use; implementation source remains a separate development step.",
      "documentation.version=2 can declare authoring:{entry:'authoring/index.json'}. Store the JSON index and guide records in source.files using the authoring schemas below. Guide SHA-256 is over the exact UTF-8 markdown. All referenced files and guide hashes are checked on save. Repository/commit/sourcePath/url and renderer kit/runner are optional for local authoring instructions; preserve full provenance and unmodified production files when wrapping an upstream project.",
      "Query catalog_describe view=parameters for generated schema + field meanings + real sample values. Select parameterPath for a field/subtree, follow parameterOffset/parameterLimit and reuse knownHash only for held text. Samples and schema defaults are not automatic data filling.",
      "Version 2 documents every schema parameter's meaning, optional omission behavior, units/coordinates where relevant and explicit opaque payloads. Declare unique/reference/index/sumMaximum relations in usage.rules; the same portable checker validates real inputs and offline sandboxes. Fallbacks declare a JSON value, from:{path,selection:first|last}, or computedFrom paths with an authored derivation description; instructions alone do not prove implementation behavior.",
      "New authored components provide manifest.documentation version=2; version=1 remains a legacy compatibility format. The versioned contract has reuse (general/domain/content-specific and boundaries; content-specific requires owner), usage (purpose, structure, input meanings, recipes, interactions/persistence, constraints and editing boundaries), and development (entry points, architecture, extensions, invariants and verification). The input.documentationSchema below is authoritative. Legacy imports without it remain readable and explicitly missing/unclassified.",
      "For derived values, declare manifest.reader=readData and export synchronous readData(props) JSON (up to 64 KiB) from the entry. Join computed fields back to source by stable IDs and mark derived fields. It executes in the component browser sandbox; do not read files or call services. Import a new version after adding or changing the contract.",
      "Describe input data, reader actions and resulting state before choosing an implementation. Search component summaries first; read source only for the chosen component being changed.",
      "Use the existing usage/development documentation fields to explain reader tasks, visual semantics, empty/error states, keyboard and narrow-view behavior, static alternatives and verification. Do not invent unsupported schema properties or cross-component interaction APIs.",
      "A local package contains manifest.json, props.schema.json and its React entry. The entry receives {data, onChange, readOnly}; onChange persists valid edits, while reading interactions keep source content unchanged.",
      "Hosts with a conversation also pass onContext and context. Call onContext({model, private?, label?}) from a reader action such as a 'hand to chat' button to give the conversation the current exploration state: model (JSON, up to 8 KiB) is visible to the Agent with the next message, private returns only to this component instance as context.private while the hand-over is pending (snapshot up to 16 KiB), label (up to 80 characters) names the chip. It returns true when handed over and false without a recent user gesture, throws on invalid snapshots, never saves the Page, never sends a message and never starts an Agent turn. Exports, previews and hosts without a conversation omit onContext: render the hand-over control only when it exists. Document the action in usage.interactions with persistence none; exploration state is not a schema field.",
      "Interactive components can import GestureBoundary from showai:components and set axes to x, y and/or zoom to own those gestures. Do not intercept unneeded axes. Native scroll regions and iframe contents already own their inputs.",
      "manifest needs id, name, version, description, scenarios, entry, defaultData, examples and documentation for new authoring. Default data and every example must pass schema; recipe exampleIndex must reference a real example. Documentation is part of immutable source and integrity. Read guide for use and development before changing implementation; source is separate.",
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
    input: {
      documentationSchema: z.toJSONSchema(componentDocumentationSchema),
      authoringIndexSchema: z.toJSONSchema(componentAuthoringIndexSchema),
      authoringGuideSchema: z.toJSONSchema(componentAuthoringGuideSchema),
      parameterContract: COMPONENT_PARAMETER_CAPABILITIES,
    },
  },
  "template-extraction": {
    purpose:
      "Abstract a user-selected mature page into a reusable template while preserving the original example.",
    rules: [
      "Trigger when the user asks to save or extract a template. Finishing a page does not automatically create a template.",
      "Read the current page and compare prior hash before extraction. Separate stable narrative/layout from instance facts, data and optional sections.",
      "Replace instance content with filling guidance or honest empty states; describe input requirements in contentGuide, contexts in scenarios, component roles in related and realistic use in examples.",
      "New templates store four stage guides (intent, material, logic, design) and optional components. The logic guide determines content logic and reading order; the design guide determines layout, visual expression and interaction for the current material. Applying starts an empty Page. Legacy schemaVersion 1–2 bundles and document/composition remain readable for historical references.",
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
      "New templates use a folder bundle: strict JSON-frontmatter README (schemaVersion 3), four stage guides (intent, material, logic, design) and optional components. import/export manage directories; MCP template_save accepts the same portable files/assets object.",
      "The system baseline is mandatory and selected task templates are explicit pinned references. template_context returns READMEs and component references; template_guide discloses one stage. Null stage declarations inherit system instructions; guide directories expose their main README and optional subfiles.",
      "Use a template's scenarios to choose it, guide to learn its content structure and related resources, and examples to see realistic sequences.",
      "Match reader task, required evidence, environment and content density before visual style. The runtime ships the mandatory system-presentation baseline and the paper-explainer method template; query the connected catalog for project and global templates and their exact revisions.",
      "contentGuide describes required inputs, optional sections, depth/layout variants, interaction/static behavior and acceptance tasks. These are Agent-facing filling instructions, not automatic variable binding. Preserve missing evidence as a limitation instead of inventing content.",
      "Applying a folder template creates an empty Page. Determine content logic and reading order during logic, then layout, visual expression and interaction during design. Legacy six-stage bundles read evidence/understanding as material/logic; legacy templates retain their saved document/composition for historical compatibility.",
      "Save new templates as schemaVersion 3 folder bundles containing README metadata, four guides and optional components. Publish a new version for revisions. Legacy page snapshots and document/composition inputs remain compatible.",
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
      "Pages showing datasets read from files outside the library (guide datasets) stop with CONFIRMATION_REQUIRED and details.externalSnapshots (bytes each external dataset adds, its file and blocks) before anything is written. Present the sizes to the person and export again with --external-data embed (MCP externalData:'embed') only once they agree; the snapshot does not update with the file.",
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
