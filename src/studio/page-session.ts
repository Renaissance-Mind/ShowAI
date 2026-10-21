import {shareNativeSource} from "../surface/native-source-delta.mjs";
import {OwnedSourceSession,createSourceTransport,sourceSessionFor} from "../surface/source-client";
import {isOwnedSource,type SourceSnapshotDelta} from "../surface/source-runtime";
import {measureNativeSync} from "../surface/native-perf";
import { coalescedTask } from "../lib/coalesced-task";
import type { JSONContent } from "@tiptap/core";
import type { PageRecord } from "../core/model";
import type { CompiledComponent } from "../components/custom/types";
import type { ShowDocument } from "../types";
import type { EditorDraftRecord } from "../core/editor-drafts";
import { errorCode, errorMessage } from "./bridge";
import { translator } from "../i18n";
import commonMessages from "../i18n/messages/common";
import pageSessionMessages from "../i18n/messages/pageSession";
import { repairEditorLinks } from "../surface/editor-links.mjs";

const t = translator(pageSessionMessages);
const common = translator(commonMessages);
const untitled = () => common("untitled");

export interface LoadedPage extends PageRecord {
  components: CompiledComponent[];
  reuseComponents?: boolean;
  reuseDocument?: boolean;
  documentMetadata?: Partial<Pick<ShowDocument, "createdAt" | "updatedAt">>;
  readOnly?: boolean;
  incomingCrossDevice?: boolean;
  sourceSnapshot?: SourceSnapshotDelta;
  sourceSnapshotDeliveryId?: string;
}
export type PageRefresh = LoadedPage | { unchanged: true; readOnly?: boolean };
export type SaveStatus =
  "saved" | "saving" | "changed" | "retained" | "conflict" | "error";
export interface PageSnapshot {
  draft: ShowDocument | null;
  renderVersion: number;
  record: LoadedPage | null;
  status: SaveStatus;
  error: string;
  draftNotice: string;
  conflictId?: string;
  mergeBase?: string;
  reviewingConflict: boolean;
  saveFailureAttempt: number;
  projectId: string | null;
  availableDrafts: EditorDraftRecord[];
  dirty: boolean;
  busy: boolean;
}
export interface PageSession {
  id: string;
  getSnapshot(): PageSnapshot;
  getMetadata(): PageSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeMetadata(listener: () => void): () => void;
  open(
    projectId: string,
    pageId: string,
    initial?: LoadedPage,
  ): Promise<boolean>;
  edit(patch: Partial<ShowDocument>): void;
  editContent(content: JSONContent): void;
  flush(settle?: boolean): Promise<boolean>;
  leave(): Promise<boolean>;
  reload(): Promise<void>;
  reloadCurrent(): Promise<boolean>;
  refresh(componentsChanged?: boolean): Promise<void>;
  retainDraft(): Promise<void>;
  recoverDraft(id: string): Promise<void>;
  keepCopy(): Promise<LoadedPage | null>;
  retry(): Promise<boolean>;
  acceptResolution(): Promise<void>;
  prepareResolution(
    document: ShowDocument,
    revision: string,
    hash: string,
  ): void;
  prepareExternalResolution(document: ShowDocument, id: string): void;
  clear(): Promise<boolean>;
  isDirty(): boolean;
  isBusy(): boolean;
  isDurable(): boolean;
  dispose(): void;
}
export interface PageSessionOptions {
  clientId: string;
  /** Actual home captured by the page-session owner; Native verifies its own scope. */
  sourceHomeId?: string;
  invoke<T>(action: string, args?: Record<string, unknown>): Promise<T>;
  saveDelayMs?: number;
  draftDelayMs?: number;
  /** Lets navigation reflect a save without refetching after its file echo. */
  onSaved?(projectId: string, record: LoadedPage): void;
}

function pageContentKey(document: ShowDocument): string {
  const { createdAt: _created, updatedAt: _updated, ...content } = document;
  const normalize = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, item]) => item !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, normalize(item)]),
          )
        : value;
  return JSON.stringify(normalize(content));
}
const ref = <T>(current: T) => ({ current });

/** A page owns its drafts and save queue independently of the displayed tab. */
export function createPageSession(options: PageSessionOptions): PageSession {
  const listeners = new Set<() => void>();
  const metadataListeners = new Set<() => void>();
  let disposed = false;
  let notifying = false;
  let metadataChanged = false;
  let durableSequence = 0;
  let snapshot: PageSnapshot;
  let metadata: PageSnapshot;
  function setter<T>(read: () => T, write: (value: T) => void) {
    return (value: T | ((previous: T) => T)) => {
      write(
        typeof value === "function"
          ? (value as (before: T) => T)(read())
          : value,
      );
      publish();
    };
  }
  function readSnapshot(): PageSnapshot {
    return {
      draft,
      renderVersion,
      record,
      status,
      error,
      draftNotice,
      conflictId,
      mergeBase,
      reviewingConflict,
      saveFailureAttempt,
      projectId: projectRef.current,
      availableDrafts,
      dirty: revision.current > savedRevision.current,
      busy: !!pending.current || !!draftWrites.current.size,
    };
  }
  function publish() {
    if (disposed) return;
    snapshot = readSnapshot();
    if (
      !metadata ||
      snapshot.draft?.id !== metadata.draft?.id ||
      snapshot.draft?.title !== metadata.draft?.title ||
      snapshot.draft?.icon !== metadata.draft?.icon ||
      snapshot.record !== metadata.record ||
      snapshot.status !== metadata.status ||
      snapshot.error !== metadata.error ||
      snapshot.renderVersion !== metadata.renderVersion ||
      snapshot.draftNotice !== metadata.draftNotice ||
      snapshot.conflictId !== metadata.conflictId ||
      snapshot.mergeBase !== metadata.mergeBase ||
      snapshot.reviewingConflict !== metadata.reviewingConflict ||
      snapshot.saveFailureAttempt !== metadata.saveFailureAttempt ||
      snapshot.projectId !== metadata.projectId ||
      snapshot.dirty !== metadata.dirty ||
      snapshot.busy !== metadata.busy ||
      snapshot.availableDrafts !== metadata.availableDrafts
    ) {
      metadata = snapshot;
      metadataChanged = true;
    }
    if (notifying) return;
    notifying = true;
    queueMicrotask(() => {
      notifying = false;
      if (disposed) return;
      const notifyMetadata = metadataChanged;
      metadataChanged = false;
      for (const listener of listeners) listener();
      if (notifyMetadata) for (const listener of metadataListeners) listener();
    });
  }

  let draft: ShowDocument | null = null;
  const setDraft = setter<ShowDocument | null>(
    () => draft,
    (value) => {
      draft = value;
    },
  );
  let renderVersion: number = 0;
  const setRenderVersion = setter<number>(
    () => renderVersion,
    (value) => {
      renderVersion = value;
    },
  );
  const refreshingPage = ref(false);
  let record: LoadedPage | null = null;
  const setRecord = setter<LoadedPage | null>(
    () => record,
    (value) => {
      record = value;
    },
  );
  const recordRef = ref<LoadedPage | null>(null);
  let status: SaveStatus = "saved";
  const setStatus = setter<SaveStatus>(
    () => status,
    (value) => {
      status = value;
    },
  );
  let error: string = "";
  const setError = setter<string>(
    () => error,
    (value) => {
      error = value;
    },
  );
  let conflictId: string | undefined = undefined;
  const setConflictId = setter<string | undefined>(
    () => conflictId,
    (value) => {
      conflictId = value;
    },
  );
  let mergeBase: string | undefined = undefined;
  const setMergeBase = setter<string | undefined>(
    () => mergeBase,
    (value) => {
      mergeBase = value;
    },
  );
  let reviewingConflict: boolean = false;
  const setReviewingConflict = setter<boolean>(
    () => reviewingConflict,
    (value) => {
      reviewingConflict = value;
    },
  );
  let saveFailureAttempt: number = 0;
  const setSaveFailureAttempt = setter<number>(
    () => saveFailureAttempt,
    (value) => {
      saveFailureAttempt = value;
    },
  );
  const resolution = ref<{
    baseRevision?: string;
    currentRevision?: string;
    externalConflictId?: string;
  } | null>(null);
  const projectRef = ref<string | null>(null);
  const current = ref<ShowDocument | null>(null);
  const base = ref("");
  const baseRevision = ref<string | undefined>(undefined);
  const draftBase = ref<string | undefined>(undefined);
  const operations = ref(new Map<number, { id: string; groupId: string }>());
  const editGroup = ref({ id: crypto.randomUUID(), at: 0 });
  const revision = ref(0);
  const savedRevision = ref(0);
  const pending = ref<Promise<boolean> | null>(null);
  const blocked = ref(false);
  const opening = ref(0);
  const clientId = ref<string | undefined>(options.clientId);
  const retained = ref<EditorDraftRecord | null>(null);
  let sourceOwner:OwnedSourceSession|undefined;
  const retireSourceOwner=(owner:OwnedSourceSession|undefined)=>{
    if(!owner)return;
    const writes=[...(pending.current?[pending.current]:[]),...draftWrites.current.values()];
    void Promise.allSettled(writes).then(()=>owner.dispose()).catch(reason=>{
      console.error("Source owner retirement failed",errorCode(reason));
    });
  };
  const ownerFor=(ownerProject:string,pageId:string)=>{
    if(!sourceOwner||sourceOwner.projectId!==ownerProject||sourceOwner.pageId!==pageId||sourceOwner.disposed){
      const previous=sourceOwner;
      sourceOwner=new OwnedSourceSession(ownerProject,pageId,createSourceTransport(options.invoke,options.sourceHomeId,{headlessHomeId:`page-session:${options.clientId}`}));
      retireSourceOwner(previous);
    }
    return sourceOwner;
  };
  const ownCurrent=(document:ShowDocument,ownerProject=projectRef.current)=>{
    if(!ownerProject)throw new Error("A page source requires its actual project owner");
    return ownerFor(ownerProject,document.id).replace(document);
  };
  const ownRecord=(page:LoadedPage,ownerProject=projectRef.current):LoadedPage=>{
    if(!ownerProject)throw new Error("A page record requires its actual project owner");
    const owner=ownerFor(ownerProject,page.document.id);
    return {...page,document:owner.captureExternal(page.document,"record")};
  };
  // Merge on the source owner's worker. A local edit arriving during the
  // await is merged again from its actual newer root before anything publishes.
  const mergeCurrentWith = async (
    baseline: ShowDocument,
    incoming: ShowDocument,
    valid: () => boolean,
    installMerged: (document: ShowDocument) => void,
    recovered?: ShowDocument,
  ): Promise<"merged" | "conflict" | "stale"> => {
    const owner=sourceOwner;
    if(!owner||!current.current||!valid())return "stale";
    const lease=`session-merge:${crypto.randomUUID()}`;
    const baseDocument=sourceSessionFor(baseline)===owner?baseline:owner.captureExternal(baseline,`${lease}:base`);
    const incomingDocument=owner.captureExternal(incoming,`${lease}:incoming`);
    const recoveredDocument=recovered?owner.captureExternal(recovered,`${lease}:recovered`):undefined;
    try{
      while(!disposed&&sourceOwner===owner&&valid()){
        const observed:ShowDocument=current.current!;
        await owner.retainHistory([baseDocument,observed,incomingDocument,...(recoveredDocument?[recoveredDocument]:[])],lease);
        let merged:Awaited<ReturnType<OwnedSourceSession["merge"]>>;
        try{merged=await owner.merge(baseDocument,recoveredDocument??observed,incomingDocument);}
        catch(reason){if(errorCode(reason)==="SOURCE_MERGE_CONFLICT")return "conflict";throw reason;}
        try{
          if(disposed||sourceOwner!==owner||!valid())return "stale";
          if(current.current!==observed){if(recoveredDocument)return "stale";continue;}
          if(merged.delta.conflicts.length)return "conflict";
          const document=owner.publishKnown(merged.document,observed);
          if(!document)continue;
          current.current=document;
          installMerged(document);
          return "merged";
        }finally{await merged.release().catch(reason=>console.error("Source merge output cleanup failed",errorCode(reason)));}
      }
      return "stale";
    }finally{
      // Cleanup must not turn an installed, valid merge into a save failure.
      await Promise.all([lease,`${lease}:base`,`${lease}:incoming`,`${lease}:recovered`].map(name=>owner.releaseLease(name).catch(reason=>console.error("Source merge lease cleanup failed",errorCode(reason)))));
    }
  };
  const recoveredFrom = ref<Pick<
    EditorDraftRecord,
    "id" | "generation"
  > | null>(null);
  let availableDrafts: EditorDraftRecord[] = [];
  const setAvailableDrafts = setter<EditorDraftRecord[]>(
    () => availableDrafts,
    (value) => {
      availableDrafts = value;
    },
  );
  let draftNotice: string = "";
  const setDraftNotice = setter<string>(
    () => draftNotice,
    (value) => {
      draftNotice = value;
    },
  );
  const draftWrites = ref(new Map<string, Promise<EditorDraftRecord>>());
  const autoSaveTimer = ref<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const draftTimer = ref<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The draft store keeps one baseline per base revision and can otherwise
  // read it from the library, so the full base page is sent only once.
  const sentBaseline = ref<string | null>(null);
  const persist = async (
    source: ShowDocument,
    sequence: number,
    owner: string,
  ): Promise<EditorDraftRecord> => {
    const key = JSON.stringify([
      owner,
      source.id,
      sequence,
      draftBase.current,
      recoveredFrom.current,
    ]);
    const pending = draftWrites.current.get(key);
    if (pending) return pending;
    const sourceModel=sourceSessionFor(source),sourceLease=`draft:${crypto.randomUUID()}`;
    const task = (async () => {
      const baseline = JSON.stringify([owner, source.id, draftBase.current]);
      const baseContent =
        sentBaseline.current !== baseline &&
        recordRef.current?.revision === draftBase.current
          ? recordRef.current?.document
          : undefined;
      if(sourceModel)await sourceModel.retainHistory([source,...(baseContent?[baseContent]:[])],sourceLease);
      const saved = await options.invoke<EditorDraftRecord>("drafts:save", {
        input: {
          kind: "page",
          clientId: clientId.current,
          resourceId: source.id,
          projectId: owner,
          baseRevision: draftBase.current,
          baseContent,
          title: source.title,
          content: source,
          sequence,
          recoverySource: recoveredFrom.current ?? undefined,
        },
      });
      if (baseContent) sentBaseline.current = baseline;
      if (
        projectRef.current === owner &&
        current.current?.id === source.id &&
        (retained.current?.sequence ?? -1) <= (saved.sequence ?? sequence)
      ) {
        retained.current = saved;
        durableSequence = Math.max(durableSequence, sequence);
      }
      return saved;
    })().finally(async()=>{
      if(sourceModel)await sourceModel.releaseLease(sourceLease).catch(reason=>console.error("Source draft lease cleanup failed",errorCode(reason)));
    });
    draftWrites.current.set(key, task);
    publish();
    try {
      return await task;
    } finally {
      if (draftWrites.current.get(key) === task)
        draftWrites.current.delete(key);
      publish();
    }
  };

  const flush = async (settle = true): Promise<boolean> => {
    if(disposed)return false;
    if (pending.current) {
      const succeeded = await pending.current;
      return succeeded && settle ? flush(true) : succeeded;
    }
    if (!current.current || !projectRef.current || blocked.current)
      return !blocked.current;
    const run = async () => {
      let mergeAttempts = 0;
      let repairedLinks = false;
      while (
        revision.current > savedRevision.current &&
        current.current &&
        projectRef.current
      ) {
        const repaired = measureNativeSync("session.save.repair",()=>repairEditorLinks(current.current!));
        if (repaired.repairs.length) {
          // Retain the exact incoming version before making its links saveable.
          try {
            const recovery = await options.invoke<EditorDraftRecord>(
              "drafts:save",
              {
                input: {
                  kind: "page",
                  clientId: `${clientId.current}:link-recovery:${crypto.randomUUID()}`,
                  resourceId: current.current.id,
                  projectId: projectRef.current,
                  baseRevision: draftBase.current,
                  baseContent: recordRef.current?.document,
                  title: current.current.title,
                  content: current.current,
                  sequence: revision.current,
                },
              },
            );
            setAvailableDrafts((items) => [recovery, ...items]);
          } catch (reason) {
            blocked.current = true;
            setStatus("error");
            setError(errorMessage(reason));
            setSaveFailureAttempt((value) => value + 1);
            return false;
          }
          current.current = ownCurrent(repaired.document);
          revision.current++;
          setDraft(current.current);
          repairedLinks = true;
        }
        const editingSource = current.current,capturedOwner=sourceOwner;
        const source = measureNativeSync("session.save.clone",()=>isOwnedSource(editingSource)?editingSource:ownCurrent(editingSource));
        if (typeof window !== "undefined")
          window.showai?.inlineInk?.copyDocumentMetadata?.(editingSource, source);
        const sequence = revision.current;
        const operation = operations.current.get(sequence) ?? {
          id: crypto.randomUUID(),
          groupId: editGroup.current.id,
        };
        operations.current.set(sequence, operation);
        setStatus("saving");
        const saveLease=`save:${operation.id}`;
        try {
          if(capturedOwner)await capturedOwner.retainHistory([source,...(recordRef.current?[recordRef.current.document]:[])],saveLease);
          const existingDraft = retained.current;
          const savedDraft =
            existingDraft?.sequence === sequence &&
            existingDraft.projectId === projectRef.current &&
            existingDraft.resourceId === source.id &&
            existingDraft.baseRevision === draftBase.current
              ? existingDraft
              : await persist(source, sequence, projectRef.current);
          const response = resolution.current?.externalConflictId
            ? await options.invoke<LoadedPage>("workspace:resolve", {
                projectId: projectRef.current,
                id: resolution.current.externalConflictId,
                resolution: "merge",
                document: source,
                historyContext: {
                  operationId: operation.id,
                  message: "解决本机保存冲突", // i18n-exempt: saved history record
                },
              })
            : resolution.current
              ? await options.invoke<LoadedPage>("page:mergeSave", {
                  projectId: projectRef.current,
                  pageId: source.id,
                  document: source,
                  ...resolution.current,
                  historyContext: {
                    operationId: operation.id,
                    message: "解决本机保存冲突", // i18n-exempt: saved history record
                  },
                })
              : await options.invoke<LoadedPage>("pages:save", {
                  projectId: projectRef.current,
                  pageId: source.id,
                  document: source,
                  baseHash: base.current,
                  reuseDocument: true,
                  baseRevision: baseRevision.current,
                  knownComponents: recordRef.current?.components.map(
                    ({ id, version, integrity, scope }) => ({
                      id,
                      version,
                      integrity,
                      scope,
                    }),
                  ),
                  historyContext: {
                    operationId: operation.id,
                    groupId: operation.groupId,
                    message: "编辑页面", // i18n-exempt: saved history record
                  },
                });
          let savedDocument:ShowDocument;
          if(response.sourceSnapshot&&capturedOwner){
            savedDocument=await capturedOwner.acceptSaved(response.sourceSnapshot,source,response.sourceSnapshotDeliveryId);
          }else{
            const returned=response.reuseDocument?{...source,...response.documentMetadata}:response.document;
            savedDocument=ownRecord({...response,document:returned}).document;
          }
          const saved = measureNativeSync("session.save.ackInstall",()=>{
            const saved = {
              ...response,
              document:savedDocument,
              components: response.reuseComponents
                ? (recordRef.current?.components ?? [])
                : response.components,
            };
            recordRef.current = saved;
            base.current = saved.hash;
            baseRevision.current = saved.revision;
            draftBase.current = saved.revision;
            setMergeBase(saved.revision);
            operations.current.delete(sequence);
            savedRevision.current = sequence;
            setRecord(saved);
            if (projectRef.current) options.onSaved?.(projectRef.current, saved);
            if (revision.current === sequence) {
              let installed:ShowDocument;
              if(response.sourceSnapshot&&capturedOwner){
                // Publishing is conditional on the exact frozen UI base. A
                // saved N body remains a record when N+1 already owns the view.
                installed=capturedOwner.publishKnown(savedDocument,source)??current.current!;
              }else{
                const shared=shareNativeSource(current.current!,savedDocument);
                installed=ownCurrent(shared);
              }
              if(typeof window!=="undefined"&&saved.reuseDocument)
                window.showai?.inlineInk?.copyDocumentMetadata?.(source,installed);
              current.current = installed;
              setDraft(installed);
            }
            return saved;
          });
          if (saved.workspaceConflicts?.length) {
            setConflictId(saved.workspaceConflicts[0].id);
            blocked.current = true;
            setStatus("conflict");
            setError(t("savedWithExternalConflict"));
            return false;
          }
          if (saved.revision && savedDraft.sequence === sequence) {
            await options.invoke("drafts:complete", {
              id: savedDraft.id,
              generation: savedDraft.generation,
              revision: saved.revision,
            });
            if (retained.current?.generation === savedDraft.generation)
              retained.current = null;
            if (recoveredFrom.current) {
              const original = recoveredFrom.current;
              await options.invoke("drafts:remove", {
                id: original.id,
                generation: original.generation,
              });
              recoveredFrom.current = null;
            }
          }
          setStatus("saved");
          resolution.current = null;
          setReviewingConflict(false);
          setError("");
          setConflictId(undefined);
          setDraftNotice(repairedLinks ? t("linksRepaired") : "");
          if (!settle) break;
        } catch (reason) {
          if (
            errorCode(reason) === "CONFLICT" &&
            !resolution.current &&
            recordRef.current &&
            current.current &&
            mergeAttempts++ < 3
          ) {
            try {
              const remote = await options.invoke<LoadedPage>("pages:get", {
                projectId: projectRef.current,
                pageId: source.id,
              });
              if (
                !remote.workspaceConflicts?.length &&
                current.current.id === source.id
              ) {
                const baseline=recordRef.current.document;
                const outcome=await mergeCurrentWith(baseline,remote.document,
                  ()=>recordRef.current?.document===baseline&&current.current?.id===source.id,
                  document=>{
                    recordRef.current=ownRecord(remote);
                    base.current=remote.hash;
                    baseRevision.current=remote.revision;
                    draftBase.current=remote.revision;
                    setMergeBase(remote.revision);
                    revision.current++;
                    setDraft(document);
                    setRecord(recordRef.current);
                  });
                if(outcome==="merged")continue;
              }
            } catch (refreshError) {
              reason = refreshError;
            }
          }

          setReviewingConflict(false);
          setSaveFailureAttempt((value) => value + 1);
          if (reason && typeof reason === "object" && "conflictId" in reason)
            setConflictId(String(reason.conflictId));
          blocked.current = true;
          setStatus(errorCode(reason) === "CONFLICT" ? "conflict" : "error");
          setError(errorMessage(reason));
          return false;
        }finally{
          if(capturedOwner)await capturedOwner.releaseLease(saveLease).catch(reason=>console.error("Source save lease cleanup failed",errorCode(reason)));
        }
      }
      return true;
    };
    const promise = run();
    pending.current = promise;
    publish();
    try {
      return await promise;
    } finally {
      if (pending.current === promise) pending.current = null;
      publish();
      if (
        !disposed &&
        !blocked.current &&
        revision.current > savedRevision.current
      ) {
        setStatus(durableSequence >= revision.current ? "retained" : "changed");
        scheduleSave();
      }
    }
  };

  const install = (projectId: string, page: LoadedPage) => {
    setSaveFailureAttempt(0);
    resolution.current = null;
    setReviewingConflict(false);
    projectRef.current = projectId;
    current.current = ownCurrent(page.document,projectId);
    page=ownRecord({...page,document:current.current},projectId);
    base.current = page.hash;
    baseRevision.current = page.revision;
    draftBase.current = page.revision;
    setMergeBase(page.revision);
    setConflictId(page.workspaceConflicts?.[0]?.id);
    operations.current.clear();
    editGroup.current = { id: crypto.randomUUID(), at: 0 };
    revision.current = 0;
    savedRevision.current = 0;
    durableSequence = 0;
    blocked.current = false;
    setDraft(current.current);
    setRecord(page);
    recordRef.current = page;
    retained.current = null;
    recoveredFrom.current = null;
    setAvailableDrafts([]);
    setDraftNotice("");
    setStatus(page.workspaceConflicts?.length ? "conflict" : "saved");
    setError(page.workspaceConflicts?.length ? t("externalUnresolved") : "");
    blocked.current = !!page.workspaceConflicts?.length;
  };

  const open = async (
    projectId: string,
    pageId: string,
    initial?: LoadedPage,
  ) => {
    if(disposed)return false;
    const ticket = ++opening.current;
    if (!(await flush())) return false;
    if (opening.current !== ticket) return false;
    const fetchedAtBase = base.current;
    const loaded =
      initial ??
      (await options.invoke<LoadedPage>("pages:get", {
        projectId,
        pageId,
      }));
    if (opening.current !== ticket) return false;
    // The editor remains usable during disk I/O. Save keystrokes entered after
    // the first flush before replacing its draft with the newly loaded page.
    if (!(await flush()) || opening.current !== ticket) return false;
    if (
      projectRef.current === projectId &&
      current.current?.id === pageId &&
      base.current !== fetchedAtBase
    )
      return true;
    install(projectId, loaded);
    const drafts = initial
      ? []
      : await options.invoke<EditorDraftRecord[]>("drafts:list", {
          kind: "page",
          projectId,
          resourceId: pageId,
        });
    if (
      opening.current !== ticket ||
      projectRef.current !== projectId ||
      current.current?.id !== pageId
    )
      return true;
    const candidate = drafts.find((item) => item.clientId === clientId.current);
    setAvailableDrafts(drafts.filter((item) => item.id !== candidate?.id));
    if (candidate) {
      const restored = await options.invoke<{
        record: EditorDraftRecord;
        content: ShowDocument;
        baseContent?: ShowDocument;
      }>("drafts:read", { id: candidate.id });
      if (opening.current !== ticket || revision.current !== 0) return true;
      // Retention can finish after the formal save or contain only a normalized
      // baseline. It carries no local edit and must not replace newer content.
      if (
        restored.baseContent &&
        pageContentKey(restored.content) ===
          pageContentKey(restored.baseContent)
      ) {
        await options.invoke("drafts:remove", {
          id: restored.record.id,
          generation: restored.record.generation,
        });
        return true;
      }
      const recoveredSequence = restored.record.sequence ?? 0;
      if (
        restored.baseContent &&
        !loaded.workspaceConflicts?.length &&
        restored.record.baseRevision !== loaded.revision
      ) {
        let unchanged=false;
        const outcome=await mergeCurrentWith(restored.baseContent,loaded.document,
          ()=>opening.current===ticket&&revision.current===0,
          document=>{
            unchanged=pageContentKey(document)===pageContentKey(loaded.document);
            setDraft(document);
            if(unchanged)return;
            revision.current=recoveredSequence+1;
            savedRevision.current=recoveredSequence;
            retained.current=restored.record;
            recoveredFrom.current=restored.record.recoverySource??null;
            setStatus("changed");
            setDraftNotice(t("draftRestored"));
            scheduleDraft();scheduleSave();
          },restored.content);
        if(outcome==="stale")return true;
        if(outcome==="merged"){
          if(unchanged)await options.invoke("drafts:remove",{id:restored.record.id,generation:restored.record.generation});
          return true;
        }
      }
      revision.current = recoveredSequence;
      savedRevision.current = recoveredSequence;
      if (
        pageContentKey(restored.content) !== pageContentKey(loaded.document)
      ) {
        current.current = ownCurrent(restored.content);
        setDraft(current.current);
        revision.current = recoveredSequence + 1;
        retained.current = restored.record;
        recoveredFrom.current = restored.record.recoverySource ?? null;
        setMergeBase(restored.record.baseRevision);
        draftBase.current = restored.record.baseRevision;
        const conflict =
          !!loaded.workspaceConflicts?.length ||
          (!!loaded.revision && !restored.record.baseRevision) ||
          (!!restored.record.baseRevision &&
            restored.record.baseRevision !== loaded.revision);
        blocked.current = conflict;
        setStatus(conflict ? "conflict" : "changed");
        setError(
          conflict
            ? !restored.record.baseRevision && loaded.revision
              ? t("legacyDraftNoBase")
              : t("draftRestoredWithChanges")
            : "",
        );
        setDraftNotice(t("draftRestored"));
        scheduleDraft();
        scheduleSave();
      }
    }
    return true;
  };

  // Reopening flushes edits before and after the read, and refuses to replace
  // unresolved drafts. Only the page's renderer needs a fresh mount.
  const reloadCurrent = async () => {
    if (!projectRef.current || !current.current || refreshingPage.current)
      return false;
    const projectId = projectRef.current,
      pageId = current.current.id;
    refreshingPage.current = true;
    try {
      if (
        !(await open(projectId, pageId)) ||
        projectRef.current !== projectId ||
        current.current?.id !== pageId
      )
        return false;
      setRenderVersion((version) => version + 1);
      return true;
    } finally {
      refreshingPage.current = false;
    }
  };

  const edit = (patch: Partial<ShowDocument>) => {
    if (disposed || !current.current || recordRef.current?.readOnly) return;
    const next = {
      ...current.current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    current.current = ownCurrent(next);
    const now = Date.now();
    if (now - editGroup.current.at > 2000)
      editGroup.current.id = crypto.randomUUID();
    editGroup.current.at = now;
    revision.current++;
    setDraft(current.current);
    if (!blocked.current) setStatus("changed");
    scheduleDraft();
    scheduleSave();
  };
  const editContent = (content: JSONContent) => edit({ content });
  const recoverDraft = async (id: string) => {
    if (!current.current || !projectRef.current) return;
    const ticket = opening.current,
      source = current.current,
      owner = projectRef.current;
    if (revision.current > savedRevision.current)
      await persist(source, revision.current, owner);
    const sequence = revision.current;
    const recovered = await options.invoke<{
      record: EditorDraftRecord;
      content: ShowDocument;
    }>("drafts:read", { id });
    if (
      opening.current !== ticket ||
      revision.current !== sequence ||
      current.current?.id !== source.id
    ) {
      setError(t("editedWhileReadingDraft"));
      return;
    }
    if (
      recovered.record.projectId !== owner ||
      recovered.record.resourceId !== source.id
    )
      throw new Error(t("draftNotForPage"));
    current.current = ownCurrent(recovered.content);
    setDraft(current.current);
    recoveredFrom.current = recovered.record;
    revision.current++;
    const conflict =
      !!conflictId ||
      !!record?.workspaceConflicts?.length ||
      (!!baseRevision.current && !recovered.record.baseRevision) ||
      (!!recovered.record.baseRevision &&
        recovered.record.baseRevision !== baseRevision.current);
    setMergeBase(recovered.record.baseRevision);
    draftBase.current = recovered.record.baseRevision;
    blocked.current = conflict;
    setStatus(conflict ? "conflict" : "changed");
    setError(
      conflict
        ? !recovered.record.baseRevision && baseRevision.current
          ? t("legacyDraftNoBase")
          : t("draftRestoredWithChanges")
        : "",
    );
    setDraftNotice(t("selectedDraftRestored"));
    setAvailableDrafts((items) => items.filter((item) => item.id !== id));
    scheduleDraft();
    scheduleSave();
  };

  let verifyComponents = false;
  const refreshTask = coalescedTask(async () => {
    if (!projectRef.current || !current.current) return;
    if (pending.current) await pending.current;
    if (!projectRef.current || !current.current) return;
    const projectId = projectRef.current,
      pageId = current.current.id;
    const knownBase = base.current,
      ticket = opening.current;
    try {
      const full = verifyComponents;
      verifyComponents = false;
      const response = await options.invoke<PageRefresh>("pages:get", {
        projectId,
        pageId,
        ...(!full
          ? { ifHash: knownBase, ifRevision: baseRevision.current }
          : {}),
        knownComponents: recordRef.current?.components.map(
          ({ id, version, integrity, scope }) => ({
            id,
            version,
            integrity,
            scope,
          }),
        ),
      });
      if (
        projectRef.current !== projectId ||
        current.current?.id !== pageId ||
        opening.current !== ticket ||
        base.current !== knownBase
      )
        return;
      if ("unchanged" in response) {
        if (
          recordRef.current &&
          recordRef.current.readOnly !== response.readOnly
        ) {
          recordRef.current = {
            ...recordRef.current,
            readOnly: response.readOnly,
          };
          setRecord(recordRef.current);
        }
        return;
      }
      const loaded = response.reuseComponents
        ? { ...response, components: recordRef.current?.components ?? [] }
        : response;
      if (
        projectRef.current !== projectId ||
        current.current?.id !== pageId ||
        opening.current !== ticket ||
        base.current !== knownBase
      )
        return;
      if (
        loaded.hash === knownBase &&
        loaded.revision === baseRevision.current &&
        loaded.readOnly === recordRef.current?.readOnly &&
        !loaded.workspaceConflicts?.length
      ) {
        if (full && loaded.components !== recordRef.current?.components) {
          recordRef.current = ownRecord(loaded);
          setRecord(recordRef.current);
        }
        return;
      }
      if (
        revision.current > savedRevision.current ||
        loaded.workspaceConflicts?.length
      ) {
        if (
          !loaded.workspaceConflicts?.length &&
          !blocked.current &&
          recordRef.current
        ) {
          const baseline=recordRef.current.document;
          const outcome=await mergeCurrentWith(baseline,loaded.document,
            ()=>opening.current===ticket&&base.current===knownBase&&recordRef.current?.document===baseline&&!blocked.current,
            document=>{
              recordRef.current=ownRecord(loaded);
              base.current=loaded.hash;
              baseRevision.current=loaded.revision;
              draftBase.current=loaded.revision;
              setMergeBase(loaded.revision);
              revision.current++;
              setDraft(document);
              setRecord(recordRef.current);
              scheduleDraft();scheduleSave();
            });
          if(outcome!=="conflict")return;
        }
        if (
          loaded.incomingCrossDevice &&
          !loaded.workspaceConflicts?.length &&
          !blocked.current
        ) {
          await flush();
          return;
        }
        setConflictId(loaded.workspaceConflicts?.[0]?.id);
        blocked.current = true;
        setStatus("conflict");
        setError(t("fileChangedElsewhere"));
      } else install(projectId, loaded);
    } catch (reason) {
      if (
        projectRef.current !== projectId ||
        current.current?.id !== pageId ||
        opening.current !== ticket ||
        base.current !== knownBase
      )
        return;
      setError(errorMessage(reason));
      setStatus("error");
    }
  });

  const refresh = (componentsChanged = false) => {
    verifyComponents ||= componentsChanged;
    return refreshTask();
  };
  const reload = async () => {
    const ticket = ++opening.current;
    if (pending.current) await pending.current;
    if (!projectRef.current || !current.current) return;
    const projectId = projectRef.current,
      pageId = current.current.id,
      sequence = revision.current;
    const loaded = await options.invoke<LoadedPage>("pages:get", {
      projectId,
      pageId,
    });
    if (
      ticket !== opening.current ||
      projectRef.current !== projectId ||
      current.current?.id !== pageId
    )
      return;
    if (revision.current !== sequence) {
      blocked.current = true;
      setStatus("conflict");
      setError(t("editedWhileReadingFile"));
      return;
    }
    install(projectId, loaded);
  };

  const keepCopy = async () => {
    const ticket = ++opening.current;
    if (pending.current) await pending.current;
    if (!projectRef.current || !current.current) return null;
    const projectId = projectRef.current,
      pageId = current.current.id,
      sequence = revision.current;
    const sourceDraft = await persist(current.current, sequence, projectId),
      sourceOrigin = recoveredFrom.current;
    const copied = await options.invoke<LoadedPage>("pages:create", {
      projectId,
      document: {
        ...current.current,
        title: t("copyTitle", { title: current.current.title || untitled() }),
      },
    });
    if (
      ticket !== opening.current ||
      projectRef.current !== projectId ||
      current.current?.id !== pageId
    )
      return null;
    const latest = current.current,
      changedDuringCopy = revision.current !== sequence;
    if (!changedDuringCopy) {
      await options.invoke("drafts:remove", {
        id: sourceDraft.id,
        generation: sourceDraft.generation,
      });
      if (sourceOrigin)
        await options.invoke("drafts:remove", {
          id: sourceOrigin.id,
          generation: sourceOrigin.generation,
        });
    }
    install(projectId, copied);
    if (changedDuringCopy) {
      recoveredFrom.current = sourceDraft;
      edit({
        ...latest,
        id: copied.document.id,
        title: t("copyTitle", { title: latest.title || untitled() }),
        createdAt: copied.document.createdAt,
      });
    }
    return copied;
  };

  const retry = async () => {
    try{await sourceOwner?.retryRegistration();}
    catch(reason){blocked.current=true;setError(errorMessage(reason));setStatus("error");return false;}
    blocked.current = false;
    setError("");
    const saved = await flush();
    if (saved) setStatus("saved");
    return saved;
  };

  const prepareResolution = (
    document: ShowDocument,
    currentRevision: string,
    currentHash: string,
  ) => {
    if (!mergeBase || !current.current || current.current.id !== document.id)
      throw new Error(t("mergeBaseExpired"));
    resolution.current = { baseRevision: mergeBase, currentRevision };
    base.current = currentHash;
    baseRevision.current = currentRevision;
    current.current = ownCurrent(document);
    revision.current++;
    blocked.current = true;
    setDraft(current.current);
    setStatus("conflict");
    setError(t("editMergedDraft"));
    setReviewingConflict(true);
    setRenderVersion((value) => value + 1);
    scheduleDraft();
  };

  const prepareExternalResolution = (document: ShowDocument, id: string) => {
    if (!current.current || current.current.id !== document.id)
      throw new Error(t("conflictNotForPage"));
    resolution.current = { externalConflictId: id };
    current.current = ownCurrent(document);
    revision.current++;
    blocked.current = true;
    setDraft(current.current);
    setStatus("conflict");
    setError(t("editMergedDraft"));
    setReviewingConflict(true);
    setRenderVersion((value) => value + 1);
  };

  // A reviewed merge or external resolution supersedes this draft. Archive its
  // exact generation; another window's newer draft must remain recoverable.
  const acceptResolution = async () => {
    const saved = retained.current;
    if (saved)
      await options.invoke("drafts:remove", {
        id: saved.id,
        generation: saved.generation,
      });
    if (recoveredFrom.current) {
      const original = recoveredFrom.current;
      await options.invoke("drafts:remove", {
        id: original.id,
        generation: original.generation,
      });
    }
    await reload();
  };

  const retainDraft = async () => {
    if (current.current && projectRef.current)
      await persist(current.current, revision.current, projectRef.current);
  };

  const clear = async () => {
    if(disposed)return false;
    const ticket = ++opening.current;
    if (!(await flush())) return false;
    if (opening.current !== ticket) return false;
    const oldSource=sourceOwner;sourceOwner=undefined;
    retireSourceOwner(oldSource);
    current.current = null;
    projectRef.current = null;
    base.current = "";
    baseRevision.current = undefined;
    draftBase.current = undefined;
    operations.current.clear();
    revision.current = 0;
    savedRevision.current = 0;
    setDraft(null);
    setRecord(null);
    setError("");
    setStatus("saved");
    return true;
  };

  let saveStartedAt = 0;
  function scheduleSave() {
    if (
      disposed ||
      blocked.current ||
      revision.current <= savedRevision.current
    )
      return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    saveStartedAt ||= Date.now();
    const delay = Math.max(
      0,
      Math.min(options.saveDelayMs ?? 700, 2000 - (Date.now() - saveStartedAt)),
    );
    autoSaveTimer.current = setTimeout(() => {
      autoSaveTimer.current = undefined;
      saveStartedAt = 0;
      void flush(false);
    }, delay);
  }
  function scheduleDraft() {
    if (
      disposed ||
      draftTimer.current ||
      revision.current <= savedRevision.current
    )
      return;
    draftTimer.current = setTimeout(() => {
      draftTimer.current = undefined;
      void retainDraft()
        .then(() => {
          if (
            !blocked.current &&
            !pending.current &&
            revision.current > savedRevision.current
          )
            setStatus(
              durableSequence >= revision.current ? "retained" : "changed",
            );
        })
        .catch((reason) => {
          setError(t("draftSaveFailed", { error: errorMessage(reason) }));
          setStatus("error");
          blocked.current = true;
        });
    }, options.draftDelayMs ?? 200);
  }
  const leave = async (): Promise<boolean> => {
    try {
      while (
        current.current &&
        projectRef.current &&
        durableSequence < revision.current
      )
        await persist(
          current.current,
          revision.current,
          projectRef.current,
        );
      if (!blocked.current && revision.current > savedRevision.current)
        void flush(false);
      return true;
    } catch (reason) {
      setError(t("draftSaveFailed", { error: errorMessage(reason) }));
      setStatus("error");
      blocked.current = true;
      return false;
    }
  };
  const api: PageSession = {
    id: crypto.randomUUID(),
    getSnapshot: () => snapshot,
    getMetadata: () => metadata,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeMetadata(listener) {
      metadataListeners.add(listener);
      return () => {
        metadataListeners.delete(listener);
      };
    },
    open,
    edit,
    editContent,
    flush,
    leave,
    reload,
    reloadCurrent,
    refresh,
    retainDraft,
    recoverDraft,
    keepCopy,
    retry,
    acceptResolution,
    prepareResolution,
    prepareExternalResolution,
    clear,
    isDirty: () => revision.current > savedRevision.current,
    isBusy: () => !!pending.current || !!draftWrites.current.size,
    isDurable: () =>
      durableSequence >= revision.current ||
      revision.current <= savedRevision.current,
    dispose() {
      disposed = true;
      retireSourceOwner(sourceOwner);
      clearTimeout(autoSaveTimer.current);
      clearTimeout(draftTimer.current);
      listeners.clear();
      metadataListeners.clear();
    },
  };
  snapshot = readSnapshot();
  metadata = snapshot;
  return api;
}
