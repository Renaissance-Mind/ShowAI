import { getGuide, GUIDE_TOPICS, type GuideTopic } from "./guides";
import { systemPresentationGuide } from "./system-presentation";
import type { TemplateStage } from "../portable/template-bundle.mjs";

const tools: Record<GuideTopic, string[]> = {
  presentation: ["guide", "template_context", "template_guide"],
  integration: [
    "showai_capabilities",
    "project_context",
    "projects_list",
    "project_resolve",
    "page_present",
  ],
  workspace: [
    "project_context",
    "projects_list",
    "project_resolve",
    "project_create",
    "pages_list",
    "library_search",
    "folders_list",
    "folder_create",
    "folder_update",
    "project_update",
    "entry_move",
    "directory_sort",
    "sidebar_read",
    "sidebar_group_create",
    "sidebar_group_update",
    "sidebar_project_move",
  ],
  authoring: [
    "page_read",
    "page_diff",
    "page_create",
    "page_apply",
    "page_save",
    "page_merge_preview",
    "page_merge_save",
    "page_present",
  ],
  reading: ["board_read", "page_read"],
  document: ["page_read", "page_apply", "page_save"],
  datasets: [
    "dataset_list",
    "dataset_read",
    "dataset_create",
    "dataset_apply",
    "dataset_link",
    "dataset_delete",
    "page_read",
    "page_apply",
    "page_export",
  ],
  containers: [
    "catalog_describe",
    "board_read",
    "page_read",
    "page_apply",
    "page_save",
  ],
  whiteboard: ["board_read", "page_read", "page_apply", "page_save"],
  catalog: [
    "catalog_list",
    "catalog_describe",
    "catalog_references",
    "component_save",
  ],
  component: [
    "catalog_list",
    "catalog_describe",
    "component_save",
    "page_apply",
    "page_present",
  ],
  templates: [
    "catalog_list",
    "catalog_describe",
    "template_save",
    "template_apply",
    "page_present",
  ],
  "template-extraction": [
    "page_read",
    "page_diff",
    "template_save",
    "template_apply",
    "page_present",
  ],
  versions: [
    "catalog_describe",
    "catalog_fork",
    "catalog_merge_preview",
    "catalog_merge_resolve",
  ],
  recovery: [
    "page_merge_preview",
    "page_merge_save",
    "workspace_conflicts",
    "workspace_conflict",
    "workspace_resolve",
    "drafts_list",
    "draft_read",
    "draft_save",
    "draft_remove",
    "draft_complete",
  ],
  sync: ["project_context", "project_sync_status", "project_sync"],
  export: ["page_present", "page_export"],
  publish: ["publication_list", "publication_prepare"],
};
const rules: Partial<Record<GuideTopic, string[]>> = {
  presentation: [],
  integration: [
    "Agent document operations use MCP. CLI remains a host setup, service launch, diagnostics and scripting interface, not an alternative authoring workflow.",
    "Confirm capabilities and connection identity. A library connection requires explicit projectId; bound connections reject another projectId; remote projects are restricted by OAuth and current membership.",
    "Route by what the user wants to keep. A visualization to see now uses show_component: one to five components, no project, nothing saved. Documents to keep, edit or share are saved in the selected project before page_present; saving a shown component reuses the same {kind,data}. render_document is for a complete standalone document. Never change library or persistence mode because a connection or export failed.",
    "show_component delivery follows the plugin's SHOWAI_HOST_DISPLAY (mcp-app, codex-visualize, model-html, image, native). Without a declaration it attaches the MCP Apps view; choose image, compact or fragment-file explicitly when the host's actual display is different.",
  ],
  workspace: [
    "For read-only lookup use projects_list or the bound project_context; do not create projects. For new formal content on a library connection, project_resolve takes an absolute trusted host sourceDirectory. It may create the directory mapping. Use project_create only when the user wants a separately named project.",
    "The connection owns its content library. Switching libraries requires the host to reconnect with another explicit configuration. Project-bound and HTTP connections cannot resolve local directories.",
    "Folders are real project metadata, not Pages. Use folders_list/folder_create/folder_update; entry_move moves folders only within a project, or pages with component dependencies across authorized projects. Page moves require their read hash/revision; reorderOnly changes sibling order. directory_sort sets direct-child sorting. project_update changes name/icon/pin/archive; remote archive/restore needs admin permission. projects_list includeArchived:true discovers archived projects.",
    "Library and remote connections expose sidebar groups/order; project-bound connections do not. Sidebar organization belongs to this connection workspace and does not synchronize to other devices. Remote cross-project moves require edit permission on both projects; inspect every synchronization receipt. Publication is destination-first with durable retry, not a cross-project server transaction.",
  ],
  authoring: [
    "Read the full Page and keep hash, revision and stable node IDs. page_save/page_apply take projectId, pageId, baseHash and baseRevision. Never use a partial view as a full replacement.",
    "CONFLICT with saveFailed means no successful save: compare original base, current Page and your changes; resolve deliberately or abandon the attempted edit. Never retry by merely refreshing version fields.",
    "After saving, page_present returns host delivery references without another save. Inspect the actual returned document.id after cross-device conflict retention.",
  ],
  export: [
    "page_present({projectId,pageId,blockIds?}) renders a saved revision. Complete HTML/source include the whole Page; optional blockIds restrict only its inline preview. Selected containers include their subtree.",
    "One rule for every host: deliver the local reader when it fits, and load the reader online only when it does not. MCP Apps consumes the attached reader metadata. Use delivery.inline as the local Codex visualization path when it is an accessible file. Hosts whose HTML tool takes markup written in the reply use delivery.compact unchanged (a few KB); without compact, deliver the HTML file instead of writing large markup. Hosts that open or publish a local file use delivery.html. HTTP delivery URLs are downloads; do not pass a URL as a local visualization path. Hosts without a display use HTML links or project receipts.",
    "delivery.inline carries the compressed local reader (offline) and switches to an online fragment only above the chat budget. delivery.html is always a complete offline file. delivery.compact and delivery.online carry only page data, embedded images and custom components and load the reader from ShowAI's reader source, then jsDelivr, then unpkg; use online only for a small file that is shared and opened online.",
    "Output placement is host/runtime configuration, not a required ~/.codex path. The local launcher accepts SHOWAI_PRESENTATION_DIR; default delivery is a runtime-owned preview directory. No arbitrary output path is accepted by page_present.",
    "If inline is too large, full HTML/source still exist and inlineError describes the limit. Retry page_present with a meaningful block selection; do not replace the saved Page with a smaller document.",
    "The MCP Apps reader reports the reader's latest local control values through model context (structuredContent.showai.readerState with blockId, label and value). They describe the user's current exploration of the preview and were not saved; use them to interpret follow-ups. Change the Page only when the user asks to keep that state.",
    "In hosts that accept model context the reader also offers right-click 'reference in chat'. The same model context then carries structuredContent.showai.reference (a showai.reference pinned to the presented hash/revision; read it as guide reading describes) and showai.components (component states handed over with onContext: blockId, componentId, name, label, model). Each update replaces the previous one; the person sees and removes it in the host input, and nothing is sent or saved until they send a message.",
    "page_export remains for an explicitly requested file/site export. Its local out path and remote availability are transport-specific; check the exposed tool schema. No fallback to authoring CLI.",
  ],
  component: [
    "component_save takes source:{manifest,schema,source,files?,assets?}. Use the same editable package contract on local and remote MCP. Compilation creates an immutable revision; reference its exact componentId/version/integrity in attrs.data, with attrs.kind=custom.",
    "Custom components receive data, onChange and readOnly. onChange sends valid edits to the host; reading state never saves by itself. Import into the chosen project, use a real Page, inspect rendering and verify interaction.",
    "Conversation hosts also pass onContext({model, private?, label?}) and context; guide component describes the limits. Show the hand-over control only when onContext exists, call it from a reader action, and verify the chip or model context in a conversation host. Without such a host, state that this path was not verified.",
  ],
  templates: [
    "New templates use input:{bundle:{format:1,files,assets?}}. files contains README.md, declared stage Markdown/folders and optional components; no host-local path is required. The logic guide determines content logic; the design guide determines layout, visual expression and interaction for each instance. Applying a folder template starts an empty Page. README JSON frontmatter is authoritative; duplicate legacy document/composition/contentGuide alongside a bundle is rejected.",
    "README metadata fields are format=showai-template, schemaVersion=3, id, name, version, description, scenarios, guides and components. Declare all four stages intent, material, logic and design; null inherits the system stage. Components declare local id/path; their package includes manifest.json, props.schema.json, entry source and versioned documentation.",
    "template_save compiles and registers namespaced template components and returns an immutable ref. Use template_context for task READMEs, fixed refs and a paged component index, then template_guide for only the current stage. Apply the exact saved ref and verify a real Page.",
    "Legacy metadata/document/composition plus optional pageId remain supported. Component version changes accompany source changes; template versions accompany guide/package changes. Project templates cannot replace the mandatory system baseline.",
  ],
  sync: [
    "Local project_sync_status reads status; project_sync is the explicit project synchronization operation. Remote HTTP project calls return synchronization.state/error/remoteHead after pull/operation/push. A retained local write with failed synchronization is not remote success.",
    "Server connection, account login and invitation management are host settings operations. Missing administrative tools do not authorize switching the Agent workflow to raw files or shell commands.",
  ],
  recovery: [
    "drafts_list/draft_read inspect retained project-scoped editor drafts. draft_save retains unsaved content, not a formal Page. Drafts stay in this library/remote connection and do not synchronize to other devices. draft_remove requires the read generation; draft_complete requires that generation and a committed page revision with matching content. Newer or different drafts are retained with CONFLICT. These operations do not replace external conflict handling or page merge.",
  ],
  publish: [
    "Publication is separate from page saving and presentation. Only invoke available tools within their project scope. Global promotion, hosting and administrative registration require the explicit host/operator flow; do not invent a missing MCP tool.",
  ],
};
/** MCP guides share model facts, but never send shell command recipes to Agents. */
export function getMcpGuide(
  topic?: string,
  stage?: TemplateStage,
  knownHash?: string,
) {
  if (stage && topic !== "presentation")
    throw new Error("Stage applies only to guide presentation.");
  if (topic === "presentation")
    return systemPresentationGuide(stage, knownHash);
  if (!topic)
    return {
      protocol: "showai-mcp-v1",
      topics: GUIDE_TOPICS.map((name) => ({
        topic: name,
        purpose: getGuide(name).purpose,
        next: { tool: "guide", arguments: { topic: name } },
      })),
    };
  const original = getGuide(topic);
  if (!("rules" in original)) throw new Error("Missing guide topic.");
  const { commands: _commands, next: _next, ...shared } = original;
  return {
    ...shared,
    protocol: "showai-mcp-v1",
    rules: [
      ...original.rules.filter(
        (rule) =>
          !/\bCLI\b|\bshowai\s+(?:guide|pages|export|sync|catalog)|--[a-z]/i.test(
            rule,
          ),
      ),
      ...(rules[topic as GuideTopic] ?? []),
    ],
    tools: tools[topic as GuideTopic],
    toolAvailability:
      "Use only tools exposed by this connection. Bound and remote scopes may omit discovery or administration. Read the actual input schema.",
  };
}
