import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/catalogManagement";
import {
  BookmarkPlus,
  Copy,
  Globe,
  Loader2,
  MoreHorizontal,
  Package,
  Trash2,
  Upload,
} from "../ui/icons";
import { desktop, errorMessage } from "../host/bridge";
import {
  exactRef,
  type PackageKind,
  type RevisionItem,
} from "./catalog-management";
import { LibraryContextMenu } from "../ui/LibraryContextMenu";

const panels = () => import("./CatalogManagementPanels");
const ForkDialog = lazy(() =>
  panels().then((m) => ({ default: m.ForkDialog })),
);
const PublishDialog = lazy(() =>
  panels().then((m) => ({ default: m.PublishDialog })),
);
const RemoveDialog = lazy(() =>
  panels().then((m) => ({ default: m.RemoveDialog })),
);
const ImportComponentDialog = lazy(() =>
  panels().then((m) => ({ default: m.ImportComponentDialog })),
);
const SaveTemplateDialog = lazy(() =>
  panels().then((m) => ({ default: m.SaveTemplateDialog })),
);
const LazyPackageVersions = lazy(() =>
  panels().then((m) => ({ default: m.PackageVersions })),
);

/** The versions tab, loaded with the other management panels. */
export function PackageVersions(props: {
  kind: PackageKind;
  item: RevisionItem;
  owner?: string;
  manager: CatalogManager;
}) {
  const t = useTranslator(messages);
  return (
    <Suspense
      fallback={
        <div className="studio-loading" role="status" aria-label={t("loading")}>
          <Loader2 size={22} className="studio-spin" aria-hidden="true" />
        </div>
      }
    >
      <LazyPackageVersions {...props} />
    </Suspense>
  );
}

/** What the workbench gives catalog dialogs to change the catalog. */
export interface CatalogManager {
  invoke: <T>(action: string, args: Record<string, unknown>) => Promise<T>;
  projects: { id: string; name: string }[];
  /** The project the person is working in, the default destination. */
  projectId?: string;
  /** The page open in the editor, offered first when saving a template. */
  openPage?: { projectId: string; pageId: string };
  /** components:remove and templates:remove are registered. */
  canRemove: boolean;
  /** Saves pending edits of the open page before reading it from disk. */
  flushPage: () => Promise<void>;
  /** Reloads the catalog lists. */
  changed: () => Promise<void>;
  openRevision: (
    kind: PackageKind,
    item: RevisionItem & { projectId?: string },
  ) => Promise<void>;
  showPage: (projectId: string, pageId: string) => Promise<void>;
  closeDetail: () => void;
}

/**
 * The workbench's catalog manager, or none where the library is read-only.
 * Removal stays hidden until the running build registers it.
 */
export function useCatalogManager(
  enabled: boolean,
  input: Omit<CatalogManager, "invoke" | "canRemove">,
): CatalogManager | undefined {
  const [canRemove, setCanRemove] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void desktop
      .invoke<{ remove: boolean }>("catalog:capabilities")
      .then((result) => current && setCanRemove(result.remove))
      .catch((reason) =>
        console.error("ShowAI catalog capabilities:", errorMessage(reason)),
      );
    return () => {
      current = false;
    };
  }, [enabled]);
  return enabled
    ? {
        ...input,
        canRemove,
        invoke: <T,>(action: string, args: Record<string, unknown>) =>
          desktop.invoke<T>(action, args),
      }
    : undefined;
}

export type ActionStatus = { error: boolean; text: string } | null;

export function PackageActions({
  kind,
  item,
  owner,
  manager,
  onStatus,
}: {
  kind: PackageKind;
  item: RevisionItem;
  /** The project that owns a project revision, or the context project. */
  owner?: string;
  manager: CatalogManager;
  onStatus: (status: ActionStatus) => void;
}) {
  const t = useTranslator(messages);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState<"fork" | "publish" | "remove" | null>(null);
  const [busy, setBusy] = useState(false);
  const builtin = item.scope === "builtin";
  const promote = async () => {
    setBusy(true);
    onStatus({ error: false, text: t("promoting") });
    try {
      const result = await manager.invoke<RevisionItem>("catalog:promote", {
        projectId: owner,
        ref: exactRef(kind, item, owner),
      });
      await manager.changed();
      onStatus({
        error: false,
        text: t("promoted", { version: result.version }),
      });
    } catch (reason) {
      onStatus({ error: true, text: errorMessage(reason) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="studio-icon"
        aria-label={t("packageActions")}
        title={t("packageActions")}
        aria-haspopup="menu"
        disabled={busy}
        onClick={(event) => {
          const anchor = event.currentTarget;
          setMenu((current) => (current === anchor ? null : anchor));
        }}
      >
        {busy ? (
          <Loader2 size={16} className="studio-spin" />
        ) : (
          <MoreHorizontal size={18} />
        )}
      </button>
      {menu && (
        <LibraryContextMenu
          anchor={menu}
          label={t("packageActions")}
          onClose={() => setMenu(null)}
          items={[
            {
              label: t("fork"),
              icon: <Copy size={15} />,
              disabled: !manager.projects.length,
              onSelect: () => setOpen("fork"),
            },
            ...(item.scope === "project" && owner
              ? [
                  {
                    label: t("promote"),
                    icon: <Globe size={15} />,
                    onSelect: () => void promote(),
                  },
                ]
              : []),
            ...(!builtin
              ? [
                  {
                    label: t("publish"),
                    icon: <Package size={15} />,
                    onSelect: () => setOpen("publish"),
                  },
                ]
              : []),
            ...(manager.canRemove && !builtin
              ? [
                  {
                    label: t("remove"),
                    icon: <Trash2 size={15} />,
                    danger: true,
                    separatorBefore: true,
                    onSelect: () => setOpen("remove"),
                  },
                ]
              : []),
          ]}
        />
      )}
      <Suspense fallback={null}>
        {open === "fork" && (
          <ForkDialog
            kind={kind}
            item={item}
            owner={owner}
            manager={manager}
            onClose={() => setOpen(null)}
          />
        )}
        {open === "publish" && (
          <PublishDialog
            kind={kind}
            item={item}
            owner={owner}
            manager={manager}
            onClose={() => setOpen(null)}
          />
        )}
        {open === "remove" && (
          <RemoveDialog
            kind={kind}
            item={item}
            owner={owner}
            manager={manager}
            onClose={() => setOpen(null)}
          />
        )}
      </Suspense>
    </>
  );
}

export function ImportComponentAction({
  manager,
}: {
  manager: CatalogManager;
}) {
  const t = useTranslator(messages);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="studio-icon"
        aria-label={t("importComponent")}
        title={t("importComponent")}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Upload size={15} />
      </button>
      {open && (
        <Suspense fallback={null}>
          <ImportComponentDialog
            manager={manager}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}

export function SaveTemplateAction({ manager }: { manager: CatalogManager }) {
  const t = useTranslator(messages);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="studio-icon"
        aria-label={t("saveAsTemplate")}
        title={t("saveAsTemplate")}
        aria-haspopup="dialog"
        disabled={!manager.projects.length}
        onClick={() => setOpen(true)}
      >
        <BookmarkPlus size={15} />
      </button>
      {open && (
        <Suspense fallback={null}>
          <SaveTemplateDialog
            manager={manager}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
