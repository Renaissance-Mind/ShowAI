/**
 * Recorded MCP tool-shape changes. guide migrations shows them, and
 * mcp-compat translates calls in the earlier shapes.
 */
export const TOOL_CHANGES: {
  date: string;
  version: string;
  before: string;
  now: string;
}[] = [
  ...(
    [
      ["dataset_list", 'dataset_read {action:"list"}'],
      [
        "dataset_read {datasetId,path?}",
        'dataset_read {action:"read",datasetId,path?}',
      ],
      ["dataset_create", 'dataset_write {action:"create",...}'],
      ["dataset_apply", 'dataset_write {action:"apply",...}'],
      ["dataset_link", 'dataset_write {action:"link",...}'],
      ["folders_list", 'organization_read {action:"folders"}'],
      ["folder_create", 'organization_update {action:"create_folder",...}'],
      ["folder_update", 'organization_update {action:"update_folder",...}'],
      ["project_update", 'organization_update {action:"update_project",...}'],
      ["directory_sort", 'organization_update {action:"sort",...}'],
      ["entry_move", 'organization_update {action:"move",...}'],
      ["sidebar_read", 'organization_read {action:"sidebar"}'],
      [
        "sidebar_group_create",
        'organization_update {action:"create_group",...}',
      ],
      [
        "sidebar_group_update",
        'organization_update {action:"update_group",...}',
      ],
      [
        "sidebar_project_move",
        'organization_update {action:"move_project",...}',
      ],
      ["drafts_list", 'draft_read {action:"list",...}'],
      ["draft_read {draftId}", 'draft_read {action:"read",draftId}'],
      ["draft_save", 'draft_write {action:"save",...}'],
      ["draft_complete", 'draft_write {action:"complete",...}'],
      ["workspace_conflicts", 'workspace_conflict {action:"list"}'],
      ["workspace_conflict {id}", 'workspace_conflict {action:"read",id}'],
      [
        "workspace_resolve {id,resolution}",
        'workspace_resolve {action:"resolve",id,resolution}',
      ],
      [
        "workspace_recover_package {conflictId,clientId}",
        'workspace_resolve {action:"recover_package",id,clientId}',
      ],
      ["catalog_fork", 'catalog_version {action:"fork",...}'],
      ["catalog_merge_resolve", 'catalog_version {action:"merge",...}'],
      [
        "component_import {directory}",
        "component_save {directory,legacy:true}",
      ],
      [
        "board_read tilePixels/overlapPixels/maxImages/pageLimit/elementLimit/margin/imageScope/theme",
        "removed: board_read uses fixed capture settings (ignored when sent)",
      ],
      ["page_read out/overwrite", "removed on every connection"],
    ] as const
  ).map(([before, now]) => ({
    date: "2026-10-23",
    version: "0.10.0",
    before,
    now,
  })),
  ...(
    [
      [
        "page_read out/overwrite",
        "restored on local connections: writes the read to a file and returns its path, sha256, hash and revision",
      ],
      [
        "page_apply operations only inline",
        "page_apply operationsFile (local): a JSON file with the operations array",
      ],
      [
        "dataset_write value/operations only inline",
        "dataset_write valueFile / operationsFile (local)",
      ],
      [
        "component_save directory for legacy packages only",
        "component_save directory for any package (manifest.documentation required unless legacy:true)",
      ],
      [
        'dataset_read {action:"read"} returns the whole value',
        "dataset_read read also takes sinceHash (record-level changes, paged with offset/limit) and out (local)",
      ],
      [
        "catalog_describe view source only inline",
        "catalog_describe view source with out (local): writes the package folder for component_save directory",
      ],
      [
        "page_diff {pageId,sinceHash} with whole field values",
        "page_diff record-level entries, paged with offset/limit/nextOffset, blockIds, out (local)",
      ],
      [
        "upgrading a component: block.remove + component.insert with all props",
        'page_apply {type:"component.ref.set",blockId,version,integrity,componentId?} keeps block id and props',
      ],
    ] as const
  ).map(([before, now]) => ({
    date: "2026-10-28",
    version: "0.10.0",
    before,
    now,
  })),
];
