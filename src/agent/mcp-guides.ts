import { getGuide, GUIDE_TOPICS, type GuideTopic } from "./guides";

const tools: Record<GuideTopic, string[]> = {
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
  reading: ["page_read"],
  document: ["page_read", "page_apply", "page_save"],
  containers: ["catalog_describe", "page_read", "page_apply", "page_save"],
  whiteboard: ["page_read", "page_apply", "page_save"],
  catalog: ["catalog_list", "catalog_describe", "component_save"],
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
  ],
  sync: ["project_context", "project_sync_status", "project_sync"],
  export: ["page_present", "page_export"],
  publish: ["publication_list", "publication_prepare"],
};
const rules: Partial<Record<GuideTopic, string[]>> = {
  integration: [
    "Agent document operations use MCP. CLI remains a host setup, service launch, diagnostics and scripting interface, not an alternative authoring workflow.",
    "Confirm capabilities and connection identity. A library connection requires explicit projectId; bound connections reject another projectId; remote projects are restricted by OAuth and current membership.",
    "Formal documents are saved in the selected project before page_present. Only explicitly standalone deliverables use render_document. Never change library or persistence mode because a connection or export failed.",
  ],
  workspace: [
    "For read-only lookup use projects_list or the bound project_context; do not create projects. For new formal content on a library connection, project_resolve takes an absolute trusted host sourceDirectory. It may create the directory mapping. Use project_create only when the user wants a separately named project.",
    "The connection owns its content library. Switching libraries requires the host to reconnect with another explicit configuration. Project-bound and HTTP connections cannot resolve local directories.",
  ],
  authoring: [
    "Read the full Page and keep hash, revision and stable node IDs. page_save/page_apply take projectId, pageId, baseHash and baseRevision. Never use a partial view as a full replacement.",
    "CONFLICT with saveFailed means no successful save: compare original base, current Page and your changes; resolve deliberately or abandon the attempted edit. Never retry by merely refreshing version fields.",
    "After saving, page_present returns host delivery references without another save. Inspect the actual returned document.id after cross-device conflict retention.",
  ],
  export: [
    "page_present({projectId,pageId,blockIds?}) renders a saved revision. Complete HTML/source include the whole Page; optional blockIds restrict only its inline preview. Selected containers include their subtree.",
    "Use delivery.inline as the local Codex visualization path when it is an accessible file. MCP Apps consumes the attached reader metadata. HTTP delivery URLs are downloads; do not pass a URL as a local visualization path. Hosts without inline use HTML links or project receipts.",
    "Output placement is host/runtime configuration, not a required ~/.codex path. The local launcher accepts SHOWAI_PRESENTATION_DIR; default delivery is a runtime-owned preview directory. No arbitrary output path is accepted by page_present.",
    "If inline is too large, full HTML/source still exist and inlineError describes the limit. Retry page_present with a meaningful block selection; do not replace the saved Page with a smaller document.",
    "page_export remains for an explicitly requested file/site export. Its local out path and remote availability are transport-specific; check the exposed tool schema. No fallback to authoring CLI.",
  ],
  component: [
    "component_save takes source:{manifest,schema,source,files?,assets?}. Use the same editable package contract on local and remote MCP. Compilation creates an immutable revision; reference its exact componentId/version/integrity in attrs.data, with attrs.kind=custom.",
    "Custom components receive data, onChange and readOnly. onChange sends valid edits to the host; reading state never saves by itself. Import into the chosen project, use a real Page, inspect rendering and verify interaction.",
  ],
  templates: [
    "template_save takes input containing metadata and abstracted document/composition, plus optional pageId. A snapshot alone is not a reusable abstraction. Apply the exact saved ref with template_apply and verify a real preview Page.",
  ],
  sync: [
    "Local project_sync_status reads status; project_sync is the explicit project synchronization operation. Remote HTTP project calls return synchronization.state/error/remoteHead after pull/operation/push. A retained local write with failed synchronization is not remote success.",
    "Server connection, account login and invitation management are host settings operations. Missing administrative tools do not authorize switching the Agent workflow to raw files or shell commands.",
  ],
  publish: [
    "Publication is separate from page saving and presentation. Only invoke available tools within their project scope. Global promotion, hosting and administrative registration require the explicit host/operator flow; do not invent a missing MCP tool.",
  ],
};
/** MCP guides share model facts, but never send shell command recipes to Agents. */
export function getMcpGuide(topic?: string) {
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
