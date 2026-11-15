import type {
  ProjectGroup,
  ProjectSummary,
  UnreadableProject,
} from "../../core/model";
import type { ShowDocument } from "../../types";
import type {
  BuiltinComponentMetadata,
  CompiledComponent,
  TemplateMetadata,
  TemplateRecord,
} from "../../contract/types";
import type { CatalogCustomComponent } from "../../core/component-categories";
import type { LibraryTarget } from "../LibraryNavigation";
import type { LoadedPage, usePage } from "../usePage";
import type { CreationChoice } from "../new-menu";
import type { WorkspaceView } from "../workspace-tabs";
import type { useWorkspaceTabs } from "../useWorkspaceTabs";
import { translator } from "../../i18n";
import errorMessages from "../../i18n/messages/errors";

export type View = WorkspaceView;
export type PageState = ReturnType<typeof usePage>;
export type WorkspaceTabs = ReturnType<typeof useWorkspaceTabs>;
export type Catalog = {
  builtin: BuiltinComponentMetadata[];
  custom: CatalogCustomComponent[];
};
export type LoadedTemplate = TemplateRecord & {
  components?: CompiledComponent[];
  previewDocument?: ShowDocument;
};
export type DialogState =
  | { type: "workspaceConflicts" }
  | { type: "migration" }
  | {
      type: "merge";
      projectId: string;
      document: ShowDocument;
      baseRevision: string;
      saveFailure?: boolean;
    }
  | { type: "externalConflict"; id: string; saveFailure?: boolean }
  | { type: "discardDraft" }
  | {
      type: "project";
      project?: ProjectSummary;
      groupId?: string;
      then?: CreationChoice;
    }
  | { type: "group"; group?: ProjectGroup; projectId?: string }
  | { type: "moveProject"; projectId: string }
  | {
      type: "batchPages";
      operation: "move" | "delete";
      targets: LibraryTarget[];
    }
  | {
      type: "newPage";
      projectId: string;
      parentId: string | null;
      templates: TemplateMetadata[];
    }
  | {
      type: "folder";
      projectId: string;
      parentId: string | null;
      target?: LibraryTarget;
    }
  | {
      type: "pageIcon";
      target: LibraryTarget;
      value: string;
      record: LoadedPage;
    }
  | { type: "rename"; target: LibraryTarget }
  | { type: "delete"; target: LibraryTarget }
  | { type: "deletedItems" }
  | { type: "hiddenProjects" }
  | { type: "shortcuts" }
  | { type: "quickJump" }
  | {
      type: "template";
      record: LoadedTemplate;
      projectId?: string;
    }
  | {
      type: "component";
      projectId?: string;
      builtin?: BuiltinComponentMetadata;
      custom?: CompiledComponent;
    }
  | null;

export type ProjectScan = {
  projects: ProjectSummary[];
  unreadable: UnreadableProject[];
};
export const operation = translator(errorMessages);
export const LOAD_LIBRARY = "loadLibrary";
export class DraftHeld extends Error {}

export type AssistantControl = {
  assistantOpen: boolean;
  changeAssistantOpen: (open: boolean) => void;
  setAssistantPrefill: (
    prefill: { key: string; pageId: string; text: string } | null,
  ) => void;
};
