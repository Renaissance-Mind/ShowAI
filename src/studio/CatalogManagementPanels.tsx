// Catalog management dialogs and the versions panel, loaded when first opened.
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  EditablePackage,
  PackageMergePreview,
} from "../contract/types";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/catalogManagement";
import catalogMessages from "../i18n/messages/catalog";
import { FileText, FolderOpen, Layers, Loader2 } from "../ui/icons";
import type {
  CatalogPackageReference,
  CatalogPageReference,
  CatalogReferences,
} from "../workbench/catalog-references";
import { errorMessage } from "./bridge";
import {
  applyMergeChoices,
  conflictLabel,
  conflictValue,
  divergence,
  exactRef,
  isStillReferenced,
  nextVersion,
  packageRevisions,
  type MergeChoice,
  type PackageKind,
  type RevisionItem,
} from "./catalog-management";
import Dialog from "./Dialog";
import "./catalog-management.css";
import type { CatalogManager } from "./CatalogManagement";
type Listed = RevisionItem & { projectId?: string };

function useBusy() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function ErrorLine({ text }: { text: string }) {
  return text ? (
    <p className="studio-form-error" role="alert">
      {text}
    </p>
  ) : null;
}

function Spinner({ busy }: { busy: boolean }) {
  return busy ? <Loader2 size={14} className="studio-spin" /> : null;
}

export function ScopeTag({ scope }: { scope: string }) {
  const t = useTranslator(catalogMessages);
  const key = (
    {
      builtin: "scope.builtin",
      global: "scope.global",
      published: "scope.published",
      project: "scope.project",
    } as const
  )[scope];
  return <span className="studio-tag">{key ? t(key) : scope}</span>;
}

function formatBytes(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ProjectSelect({
  manager,
  value,
  onChange,
}: {
  manager: CatalogManager;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslator(messages);
  return (
    <label>
      {t("project")}
      <select
        value={value}
        required
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled>
          {t("chooseProject")}
        </option>
        {manager.projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Revisions of every package of a kind visible from a project, tagged with their owner. */
async function listRevisions(
  manager: CatalogManager,
  kind: PackageKind,
  projectId?: string,
): Promise<Listed[]> {
  const items = await manager.invoke<(Listed & { kind?: string })[]>(
    kind === "component" ? "components:list" : "templates:list",
    { scope: "all", ...(projectId ? { projectId } : {}) },
  );
  return items
    .filter((item) => !(kind === "component" && "kind" in item))
    .map((item) =>
      item.scope === "project" && projectId ? { ...item, projectId } : item,
    );
}

/** The detail dialog's menu: copy, promote, publish and delete this revision. */
export function ForkDialog({
  kind,
  item,
  owner,
  manager,
  onClose,
}: {
  kind: PackageKind;
  item: RevisionItem;
  owner?: string;
  manager: CatalogManager;
  onClose: () => void;
}) {
  const t = useTranslator(messages);
  const [target, setTarget] = useState(
    manager.projectId ?? owner ?? manager.projects[0]?.id ?? "",
  );
  const [version, setVersion] = useState(""),
    [edited, setEdited] = useState(false),
    [name, setName] = useState(item.name);
  const { busy, error, setError, run } = useBusy();
  useEffect(() => {
    if (!target || edited) return;
    let current = true;
    void listRevisions(manager, kind, target)
      .then((items) => {
        if (!current) return;
        const taken = items
          .filter((other) => other.id === item.id && other.scope === "project")
          .map((other) => other.version);
        setVersion(nextVersion(item.version, [item.version, ...taken]));
      })
      .catch((reason) => current && setError(errorMessage(reason)));
    return () => {
      current = false;
    };
  }, [target]);
  return (
    <Dialog
      title={t("forkTitle", { name: item.name })}
      onClose={onClose}
      dismissible={!busy}
    >
      <form
        className="studio-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          void run(async () => {
            const result = await manager.invoke<RevisionItem>("catalog:fork", {
              projectId: target,
              ref: exactRef(kind, item, owner),
              version: version.trim(),
              ...(name.trim() && name.trim() !== item.name
                ? { name: name.trim() }
                : {}),
            });
            await manager.changed();
            onClose();
            await manager.openRevision(kind, { ...result, projectId: target });
          });
        }}
      >
        <ProjectSelect manager={manager} value={target} onChange={setTarget} />
        <label>
          {t("name")}
          <input
            value={name}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          {t("version")}
          <input
            value={version}
            required
            pattern="\d+\.\d+\.\d+(-[0-9A-Za-z.\-]+)?"
            onChange={(event) => {
              setEdited(true);
              setVersion(event.target.value);
            }}
          />
        </label>
        <ErrorLine text={error} />
        <footer>
          <button type="button" className="studio-button" onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            type="submit"
            className="studio-button primary"
            disabled={busy || !target || !version.trim()}
          >
            <Spinner busy={busy} />
            {t("forkSubmit")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

interface PreparedPublication {
  path: string;
  manifestPath: string;
  bytes: number;
  manifest: { packages: unknown[] };
}
interface VerifiedPublication {
  packages?: unknown[];
  components?: unknown[];
  templates?: unknown[];
}

export function PublishDialog({
  kind,
  item,
  owner,
  manager,
  onClose,
}: {
  kind: PackageKind;
  item: RevisionItem;
  owner?: string;
  manager: CatalogManager;
  onClose: () => void;
}) {
  const t = useTranslator(messages);
  const [prepared, setPrepared] = useState<PreparedPublication | null>(null);
  const [url, setUrl] = useState("");
  const [verified, setVerified] = useState<number | null>(null);
  const { busy, error, run } = useBusy();
  return (
    <Dialog
      title={t("publishTitle", { name: item.name, version: item.version })}
      onClose={onClose}
      dismissible={!busy}
      className="catalog-publish-dialog"
    >
      <div className="studio-form">
        {!prepared ? (
          <footer>
            <button type="button" className="studio-button" onClick={onClose}>
              {t("cancel")}
            </button>
            <button
              type="button"
              className="studio-button primary"
              data-autofocus
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result =
                    await manager.invoke<PreparedPublication | null>(
                      "catalog:preparePublish",
                      {
                        ref: exactRef(kind, item, owner),
                        ...(owner ? { projectId: owner } : {}),
                      },
                    );
                  if (result) setPrepared(result);
                })
              }
            >
              <Spinner busy={busy} />
              <FolderOpen size={15} />
              {t("prepare")}
            </button>
          </footer>
        ) : (
          <>
            <dl className="catalog-facts" role="status">
              <dt>{t("preparedAt")}</dt>
              <dd>
                <code>{prepared.path}</code>
              </dd>
              <dt>{t("manifestFile")}</dt>
              <dd>
                <code>{prepared.manifestPath}</code>
              </dd>
              <dt>{t("size")}</dt>
              <dd>{formatBytes(prepared.bytes)}</dd>
            </dl>
            <form
              className="catalog-inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (busy) return;
                setVerified(null);
                void run(async () => {
                  const result = await manager.invoke<VerifiedPublication>(
                    "catalog:verifyPublish",
                    {
                      manifestUrl: url.trim(),
                      ...(owner ? { projectId: owner } : {}),
                    },
                  );
                  setVerified(
                    (result.packages ?? prepared.manifest.packages).length,
                  );
                  await manager.changed();
                });
              }}
            >
              <label>
                {t("manifestUrl")}
                <input
                  type="url"
                  required
                  value={url}
                  placeholder="https://…/manifest.json"
                  onChange={(event) => {
                    setUrl(event.target.value);
                    setVerified(null);
                  }}
                />
              </label>
              <button
                type="submit"
                className="studio-button primary"
                disabled={busy || !url.trim()}
              >
                <Spinner busy={busy} />
                {t("verify")}
              </button>
            </form>
            {verified !== null && (
              <p className="catalog-action-status" role="status">
                {t("verified", { count: verified })}
              </p>
            )}
            <footer>
              <button
                type="button"
                className="studio-text-button"
                onClick={() =>
                  void run(() =>
                    manager.invoke<void>("fs:reveal", { path: prepared.path }),
                  )
                }
              >
                <FolderOpen size={15} />
                {t("showFolder")}
              </button>
              <button type="button" className="studio-button" onClick={onClose}>
                {t("close")}
              </button>
            </footer>
          </>
        )}
        <ErrorLine text={error} />
      </div>
    </Dialog>
  );
}

function ReferenceList({
  references,
  manager,
}: {
  references: CatalogReferences;
  manager: CatalogManager;
}) {
  const t = useTranslator(messages);
  return (
    <>
      {!!references.pages.length && (
        <ul className="catalog-reference-pages">
          {references.pages.map((page) => (
            <li key={`${page.projectId}/${page.pageId}`}>
              <PageLink page={page} manager={manager} />
            </li>
          ))}
        </ul>
      )}
      {!!references.packages.length && (
        <>
          <h4>{t("dependents")}</h4>
          <ul className="catalog-reference-packages">
            {references.packages.map((item) => (
              <li
                key={`${item.projectId ?? ""}/${item.kind}/${item.id}/${item.version}`}
              >
                <PackageLabel item={item} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function PageLink({
  page,
  manager,
}: {
  page: CatalogPageReference;
  manager: CatalogManager;
}) {
  return (
    <button
      type="button"
      className="catalog-reference-page"
      onClick={() => void manager.showPage(page.projectId, page.pageId)}
    >
      <FileText size={14} />
      <span>{page.title}</span>
      <small>{page.projectName}</small>
    </button>
  );
}

function PackageLabel({ item }: { item: CatalogPackageReference }) {
  const t = useTranslator(catalogMessages);
  return (
    <span className="catalog-reference-package">
      <span>
        {t(item.kind === "component" ? "kind.component" : "kind.template")}
      </span>
      <span>
        {item.name ?? item.id}
        {item.version ? ` v${item.version}` : ""}
      </span>
      <ScopeTag scope={item.scope} />
      {item.projectName && <small>{item.projectName}</small>}
    </span>
  );
}

export function RemoveDialog({
  kind,
  item,
  owner,
  manager,
  onClose,
}: {
  kind: PackageKind;
  item: RevisionItem;
  owner?: string;
  manager: CatalogManager;
  onClose: () => void;
}) {
  const t = useTranslator(messages);
  const tc = useTranslator(catalogMessages);
  const [siblings, setSiblings] = useState<Listed[]>([item]);
  const [all, setAll] = useState(false);
  const [blocked, setBlocked] = useState<CatalogReferences | null>(null);
  const { busy, error, setError, run } = useBusy();
  useEffect(() => {
    let current = true;
    void listRevisions(
      manager,
      kind,
      item.scope === "project" ? owner : undefined,
    )
      .then((items) => {
        if (current)
          setSiblings(
            packageRevisions(items, item.id).filter(
              (other) => other.scope === item.scope,
            ),
          );
      })
      .catch((reason) => current && setError(errorMessage(reason)));
    return () => {
      current = false;
    };
  }, []);
  const remove = () =>
    run(async () => {
      setBlocked(null);
      for (const target of all ? siblings : [item]) {
        const ref = exactRef(kind, target, owner);
        try {
          await manager.invoke<unknown>(`${kind}s:remove`, {
            ref,
            ...(owner ? { projectId: owner } : {}),
          });
        } catch (reason) {
          if (isStillReferenced(reason))
            setBlocked(
              await manager.invoke<CatalogReferences>("catalog:references", {
                kind,
                id: target.id,
                version: target.version,
                integrity: target.integrity,
              }),
            );
          await manager.changed();
          throw reason;
        }
      }
      await manager.changed();
      onClose();
      manager.closeDetail();
    });
  return (
    <Dialog
      title={t("removeTitle", { name: item.name })}
      onClose={onClose}
      dismissible={!busy}
    >
      <div className="studio-form">
        <fieldset className="catalog-choice" disabled={busy}>
          <label>
            <input
              type="radio"
              name="remove-target"
              checked={!all}
              onChange={() => setAll(false)}
            />
            {t("removeRevision", { version: item.version })}
          </label>
          {siblings.length > 1 && (
            <label>
              <input
                type="radio"
                name="remove-target"
                checked={all}
                onChange={() => setAll(true)}
              />
              {t("removeAll", {
                count: siblings.length,
                scope: tc(`scope.${item.scope}` as "scope.project"),
              })}
            </label>
          )}
        </fieldset>
        <ErrorLine text={error} />
        {!!blocked && blocked.pages.length + blocked.packages.length > 0 && (
          <section className="catalog-blocking-references">
            {!!blocked.pages.length && <h4>{t("stillUsedByPages")}</h4>}
            <ReferenceList references={blocked} manager={manager} />
          </section>
        )}
        <footer>
          <button type="button" className="studio-button" onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="studio-button danger"
            data-autofocus
            disabled={busy}
            onClick={() => void remove()}
          >
            <Spinner busy={busy} />
            {t("removeSubmit")}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}

/** The versions tab: every revision, where each is used, and merging from the origin. */
export function PackageVersions({
  kind,
  item,
  owner,
  manager,
}: {
  kind: PackageKind;
  item: RevisionItem;
  owner?: string;
  manager: CatalogManager;
}) {
  const t = useTranslator(messages);
  const [items, setItems] = useState<Listed[] | null>(null);
  const [references, setReferences] = useState<CatalogReferences | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [theirs, setTheirs] = useState("");
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const context =
    item.scope === "project" ? owner : (owner ?? manager.projectId);
  useEffect(() => {
    let current = true;
    setError("");
    void Promise.all([
      listRevisions(manager, kind, context),
      manager.invoke<CatalogReferences>("catalog:references", {
        kind,
        id: item.id,
      }),
    ])
      .then(([list, refs]) => {
        if (!current) return;
        setItems(list);
        setReferences(refs);
      })
      .catch((reason) => current && setError(errorMessage(reason)));
    return () => {
      current = false;
    };
  }, [kind, item.id, item.integrity, context, reload]);
  const revisions = useMemo(
    () => (items ? packageRevisions(items, item.id) : []),
    [items, item.id],
  );
  const origin = useMemo(
    () => (items ? divergence(item, items) : null),
    [items, item],
  );
  useEffect(() => {
    setTheirs(origin?.candidates[0]?.integrity ?? "");
  }, [origin]);
  if (error) return <ErrorLine text={error} />;
  if (!items || !references)
    return (
      <div className="studio-loading" role="status" aria-label={t("loading")}>
        <Loader2 size={22} className="studio-spin" aria-hidden="true" />
      </div>
    );
  const uses =
    (revision: Listed) => (used: { version?: string; integrity?: string }) =>
      used.integrity
        ? used.integrity === revision.integrity
        : used.version === revision.version;
  const pagesFor = (revision: Listed) =>
    references.pages.filter((page) => page.revisions.some(uses(revision)));
  const packagesFor = (revision: Listed) =>
    references.packages.filter((other) => other.revisions.some(uses(revision)));
  const theirsItem = origin?.candidates.find(
    (candidate) => candidate.integrity === theirs,
  );
  return (
    <div className="catalog-versions">
      {origin && (
        <section className="catalog-origin" aria-label={t("originNewer")}>
          <h3>{t("originNewer")}</h3>
          <label>
            {t("originVersion")}
            <select
              value={theirs}
              onChange={(event) => setTheirs(event.target.value)}
            >
              {origin.candidates.map((candidate) => (
                <option key={candidate.integrity} value={candidate.integrity}>
                  v{candidate.version}
                </option>
              ))}
            </select>
          </label>
          <span className="catalog-origin-base">
            {t("mergeBase", { version: origin.base.version })}
          </span>
          <button
            type="button"
            className="studio-button primary"
            disabled={!theirsItem}
            onClick={() => setMerging(true)}
          >
            <Layers size={15} />
            {t("compareMerge")}
          </button>
        </section>
      )}
      <table className="catalog-version-table">
        <thead>
          <tr>
            <th scope="col">{t("column.version")}</th>
            <th scope="col">{t("column.scope")}</th>
            <th scope="col">{t("column.updated")}</th>
            <th scope="col">{t("column.pages")}</th>
          </tr>
        </thead>
        <tbody>
          {revisions.map((revision) => {
            const key = `${revision.scope}:${revision.integrity}`;
            const current =
              revision.integrity === item.integrity &&
              revision.scope === item.scope;
            const pages = pagesFor(revision);
            const dependents = packagesFor(revision);
            const used = pages.length + dependents.length;
            return (
              <VersionRow
                key={key}
                current={current}
                expanded={expanded === key}
                onToggle={() =>
                  setExpanded((value) => (value === key ? null : key))
                }
                onOpen={() =>
                  void manager
                    .openRevision(kind, revision)
                    .catch((reason) => setError(errorMessage(reason)))
                }
                revision={revision}
                used={used}
                pages={pages.length}
              >
                <ReferenceList
                  references={{ pages, packages: dependents }}
                  manager={manager}
                />
              </VersionRow>
            );
          })}
        </tbody>
      </table>
      {merging && origin && theirsItem && owner && (
        <PackageMergeDialog
          kind={kind}
          base={origin.base}
          ours={item}
          theirs={theirsItem}
          owner={owner}
          taken={revisions
            .filter((revision) => revision.scope === "project")
            .map((revision) => revision.version)}
          manager={manager}
          onClose={() => setMerging(false)}
          onMerged={() => setReload((value) => value + 1)}
        />
      )}
    </div>
  );
}

function VersionRow({
  revision,
  current,
  expanded,
  used,
  pages,
  onToggle,
  onOpen,
  children,
}: {
  revision: Listed;
  current: boolean;
  expanded: boolean;
  used: number;
  pages: number;
  onToggle: () => void;
  onOpen: () => void;
  children: ReactNode;
}) {
  const t = useTranslator(messages);
  const panel = useId();
  return (
    <>
      <tr className={current ? "is-current" : undefined}>
        <td>
          {current ? (
            <span className="catalog-version-current">
              v{revision.version}
              <span className="studio-tag">{t("current")}</span>
            </span>
          ) : (
            <button
              type="button"
              className="studio-text-button"
              aria-label={t("openRevision", { version: revision.version })}
              onClick={onOpen}
            >
              v{revision.version}
            </button>
          )}
        </td>
        <td>
          <ScopeTag scope={revision.scope} />
        </td>
        <td>
          {revision.updatedAt
            ? new Date(revision.updatedAt).toLocaleString()
            : "—"}
        </td>
        <td>
          {used ? (
            <button
              type="button"
              className="studio-text-button"
              aria-expanded={expanded}
              aria-controls={panel}
              aria-label={t("showUsage", { version: revision.version })}
              onClick={onToggle}
            >
              {pages ? t("pagesCount", { count: pages }) : t("dependents")}
            </button>
          ) : (
            t("noPages")
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="catalog-version-usage">
          <td colSpan={4} id={panel}>
            <h4>{t("usedBy", { version: revision.version })}</h4>
            {children}
          </td>
        </tr>
      )}
    </>
  );
}

function PackageMergeDialog({
  kind,
  base,
  ours,
  theirs,
  owner,
  taken,
  manager,
  onClose,
  onMerged,
}: {
  kind: PackageKind;
  base: Listed;
  ours: RevisionItem;
  theirs: Listed;
  owner: string;
  taken: string[];
  manager: CatalogManager;
  onClose: () => void;
  onMerged: () => void;
}) {
  const t = useTranslator(messages);
  const [preview, setPreview] = useState<PackageMergePreview | null>(null);
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
  const [version, setVersion] = useState(() =>
    nextVersion(ours.version, [ours.version, ...taken]),
  );
  const { busy, error, setError, run } = useBusy();
  const refs = useRef({
    projectId: owner,
    base: exactRef(kind, base, base.projectId),
    ours: exactRef(kind, ours, owner),
    theirs: exactRef(kind, theirs, theirs.projectId),
  });
  useEffect(() => {
    let current = true;
    void manager
      .invoke<PackageMergePreview>("catalog:mergePreview", refs.current)
      .then((result) => current && setPreview(result))
      .catch((reason) => current && setError(errorMessage(reason)));
    return () => {
      current = false;
    };
  }, []);
  return (
    <Dialog
      title={t("mergeTitle", { theirs: theirs.version, ours: ours.version })}
      onClose={onClose}
      dismissible={!busy}
      wide
      className="catalog-merge-dialog"
    >
      <form
        className="studio-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !preview) return;
          void run(async () => {
            const resolved: EditablePackage = applyMergeChoices(
              preview.merged,
              preview.conflicts,
              choices,
            );
            const result = await manager.invoke<RevisionItem>(
              "catalog:mergeSave",
              { ...refs.current, version: version.trim(), resolved },
            );
            await manager.changed();
            onMerged();
            onClose();
            await manager.openRevision(kind, { ...result, projectId: owner });
          });
        }}
      >
        <p className="catalog-origin-base">
          {t("mergeBase", { version: base.version })}
        </p>
        {!preview && !error && (
          <div
            className="studio-loading"
            role="status"
            aria-label={t("loading")}
          >
            <Loader2 size={22} className="studio-spin" aria-hidden="true" />
          </div>
        )}
        {preview && (
          <>
            <h3 className="catalog-merge-count">
              {preview.conflicts.length
                ? t("conflicts", { count: preview.conflicts.length })
                : t("noConflicts")}
            </h3>
            {preview.conflicts.map((conflict) => (
              <fieldset key={conflict.path} className="catalog-conflict">
                <legend>
                  <code>{conflictLabel(conflict.path)}</code>
                </legend>
                {(["ours", "theirs"] as const).map((side) => {
                  const value = conflictValue(conflict[side]);
                  return (
                    <label key={side}>
                      <span>
                        <input
                          type="radio"
                          name={conflict.path}
                          checked={(choices[conflict.path] ?? "ours") === side}
                          onChange={() =>
                            setChoices((current) => ({
                              ...current,
                              [conflict.path]: side,
                            }))
                          }
                        />
                        {t(side === "ours" ? "keepProject" : "takeOrigin")}
                      </span>
                      <pre>{value ?? t("removedValue")}</pre>
                    </label>
                  );
                })}
              </fieldset>
            ))}
            <label>
              {t("mergedVersion")}
              <input
                value={version}
                required
                pattern="\d+\.\d+\.\d+(-[0-9A-Za-z.\-]+)?"
                onChange={(event) => setVersion(event.target.value)}
              />
            </label>
          </>
        )}
        <ErrorLine text={error} />
        <footer>
          <button type="button" className="studio-button" onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            type="submit"
            className="studio-button primary"
            disabled={busy || !preview || !version.trim()}
          >
            <Spinner busy={busy} />
            {t("mergeSave")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

/** The component list's import action: a component package folder into a project. */
export function ImportComponentDialog({
  manager,
  onClose,
}: {
  manager: CatalogManager;
  onClose: () => void;
}) {
  const t = useTranslator(messages);
  const [projectId, setProjectId] = useState(
    manager.projectId ?? manager.projects[0]?.id ?? "",
  );
  const [result, setResult] = useState<Listed | null>(null);
  const { busy, error, run } = useBusy();
  const finish = async (component: RevisionItem | null) => {
    if (!component) return;
    setResult({ ...component, projectId });
    await manager.changed();
  };
  return (
    <Dialog title={t("importTitle")} onClose={onClose} dismissible={!busy}>
      <form
        className="studio-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !projectId) return;
          setResult(null);
          void run(async () =>
            finish(
              await manager.invoke<RevisionItem | null>("components:import", {
                projectId,
              }),
            ),
          );
        }}
      >
        <ProjectSelect
          manager={manager}
          value={projectId}
          onChange={(value) => {
            setProjectId(value);
            setResult(null);
          }}
        />
        <ErrorLine text={error} />
        {result && (
          <p className="catalog-action-status" role="status">
            {t("imported", { name: result.name, version: result.version })}
          </p>
        )}
        <footer>
          <button
            type="button"
            className="studio-text-button"
            disabled={busy || !projectId}
            onClick={() => {
              setResult(null);
              void run(async () =>
                finish(
                  await manager.invoke<RevisionItem>(
                    "components:createExample",
                    { projectId },
                  ),
                ),
              );
            }}
          >
            {t("createExample")}
          </button>
          {result ? (
            <button
              type="button"
              className="studio-button primary"
              data-autofocus
              onClick={() => {
                onClose();
                void manager.openRevision("component", result);
              }}
            >
              {t("open")}
            </button>
          ) : (
            <button
              type="submit"
              className="studio-button primary"
              disabled={busy || !projectId}
            >
              <Spinner busy={busy} />
              <FolderOpen size={15} />
              {t("chooseFolder")}
            </button>
          )}
        </footer>
      </form>
    </Dialog>
  );
}

/** The template list's save action: an existing page becomes a new template or version. */
export function SaveTemplateDialog({
  manager,
  onClose,
}: {
  manager: CatalogManager;
  onClose: () => void;
}) {
  const t = useTranslator(messages);
  const [projectId, setProjectId] = useState(
    manager.openPage?.projectId ??
      manager.projectId ??
      manager.projects[0]?.id ??
      "",
  );
  const [pages, setPages] = useState<{ id: string; title: string }[] | null>(
    null,
  );
  const [templates, setTemplates] = useState<Listed[]>([]);
  const [pageId, setPageId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [version, setVersion] = useState("1.0.0");
  const [saved, setSaved] = useState<Listed | null>(null);
  const { busy, error, setError, run } = useBusy();
  useEffect(() => {
    if (!projectId) return;
    let current = true;
    setPages(null);
    void Promise.all([
      manager.invoke<{ id: string; title: string }[]>("pages:list", {
        projectId,
      }),
      listRevisions(manager, "template", projectId),
    ])
      .then(([list, catalog]) => {
        if (!current) return;
        setPages(list);
        setTemplates(catalog.filter((item) => item.scope === "project"));
        const preferred =
          manager.openPage?.projectId === projectId &&
          list.some((page) => page.id === manager.openPage?.pageId)
            ? manager.openPage.pageId
            : (list[0]?.id ?? "");
        setPageId(preferred);
        setName(list.find((page) => page.id === preferred)?.title ?? "");
        setTemplateId("");
        setVersion("1.0.0");
      })
      .catch((reason) => current && setError(errorMessage(reason)));
    return () => {
      current = false;
    };
  }, [projectId]);
  // One entry per template package, showing its newest revision.
  const existing = useMemo(
    () =>
      [...new Set(templates.map((item) => item.id))].map(
        (id) => packageRevisions(templates, id)[0],
      ),
    [templates],
  );
  return (
    <Dialog
      title={t("saveTemplateTitle")}
      onClose={onClose}
      dismissible={!busy}
    >
      <form
        className="studio-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !pageId) return;
          setSaved(null);
          void run(async () => {
            if (
              manager.openPage?.projectId === projectId &&
              manager.openPage.pageId === pageId
            )
              await manager.flushPage();
            const result = await manager.invoke<Listed>("templates:save", {
              projectId,
              pageId,
              name: name.trim(),
              description: description.trim(),
              version: version.trim(),
              ...(templateId ? { id: templateId } : {}),
            });
            setSaved({ ...result, projectId });
            await manager.changed();
          });
        }}
      >
        <ProjectSelect
          manager={manager}
          value={projectId}
          onChange={setProjectId}
        />
        <label>
          {t("page")}
          <select
            value={pageId}
            required
            disabled={!pages?.length}
            onChange={(event) => {
              setPageId(event.target.value);
              if (!templateId)
                setName(
                  pages?.find((page) => page.id === event.target.value)
                    ?.title ?? "",
                );
            }}
          >
            {pages && !pages.length && (
              <option value="">{t("projectHasNoPages")}</option>
            )}
            {pages?.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("template")}
          <select
            value={templateId}
            onChange={(event) => {
              const id = event.target.value;
              setTemplateId(id);
              const latest = packageRevisions(templates, id)[0];
              if (latest) {
                setName(latest.name);
                setVersion(
                  nextVersion(
                    latest.version,
                    packageRevisions(templates, id).map((item) => item.version),
                  ),
                );
              } else setVersion("1.0.0");
            }}
          >
            <option value="">{t("newTemplate")}</option>
            {existing.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · v{item.version}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("name")}
          <input
            value={name}
            required
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          {t("description")}
          <textarea
            value={description}
            maxLength={2000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label>
          {t("version")}
          <input
            value={version}
            required
            pattern="\d+\.\d+\.\d+(-[0-9A-Za-z.\-]+)?"
            onChange={(event) => setVersion(event.target.value)}
          />
        </label>
        <ErrorLine text={error} />
        {saved && (
          <p className="catalog-action-status" role="status">
            {t("savedTemplate", { name: saved.name, version: saved.version })}
          </p>
        )}
        <footer>
          <button type="button" className="studio-button" onClick={onClose}>
            {t("close")}
          </button>
          {saved ? (
            <button
              type="button"
              className="studio-button primary"
              data-autofocus
              onClick={() => {
                onClose();
                void manager.openRevision("template", saved);
              }}
            >
              {t("open")}
            </button>
          ) : (
            <button
              type="submit"
              className="studio-button primary"
              disabled={busy || !pageId || !name.trim()}
            >
              <Spinner busy={busy} />
              {t("save")}
            </button>
          )}
        </footer>
      </form>
    </Dialog>
  );
}
