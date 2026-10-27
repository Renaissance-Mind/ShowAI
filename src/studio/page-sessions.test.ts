import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startBrowserServer } from "../browser/server";
import { withLibraryLock } from "../core/library-lock";
import { serializeArtifact } from "../portable/validation.mjs";
import { PageSessions } from "./page-sessions";
import {createResource} from "../surface/containers.mjs";
import {addNode} from "../surface/editing";
import {createPortableInk} from "../surface/portable-ink.mjs";
import {findSurfaceNode,reconcileSurface} from "../surface/document.mjs";
import {createPageSession,type LoadedPage} from "./page-session";
import type { ContainerDocument } from "../types";
import type { JSONContent } from "@tiptap/core";
import {HistoryTravelQueue} from "../surface/history-travel-queue";
import {sourceSessionFor} from "../surface/source-client";

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
describe("workspace sessions against the real loopback workbench", () => {
  let directory: string;
  let home: string;
  let server: Awaited<ReturnType<typeof startBrowserServer>>;
  let sessions: PageSessions;
  let project: string;
  let first: LoadedPage;
  let second: LoadedPage;
  const calls: string[] = [];
  let invoke: <T>(action: string, args?: Record<string, unknown>) => Promise<T>;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "showai-page-sessions-"));
    home = join(directory, "library");
    server = await startBrowserServer({
      home,
      webRoot: resolve("dist-runtime/web"),
      cliEntry: resolve("dist-runtime/scripts/cli.mjs"),
      settingsPath: join(directory, "profile", "settings.json"),
    });
    const html = await (await fetch(server.url)).text();
    const token = JSON.parse(
      html.match(/window\.__SHOWAI_LOCAL__=(\{[^<]+\})<\/script>/)![1],
    ).token;
    invoke = async <T>(
      action: string,
      args: Record<string, unknown> = {},
    ): Promise<T> => {
      calls.push(action);
      const response = await fetch(server.url + "api/invoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action, args }),
      });
      const result = await response.json();
      if (!result.ok) throw result.error;
      return result.data;
    };
    project = (
      await invoke<{ id: string }>("projects:create", { name: "Workspace" })
    ).id;
    first = await invoke<LoadedPage>("pages:create", {
      projectId: project,
      title: "First",
    });
    second = await invoke<LoadedPage>("pages:create", {
      projectId: project,
      title: "Second",
    });
    sessions = new PageSessions({
      clientId: "workspace-test-client",
      invoke,
      saveDelayMs: 50,
      draftDelayMs: 20,
    });
    sessions.setHome(home);
    calls.length = 0;
  });
  it("opens a just-created page without rereading or looking up recovery drafts", async () => {
    const before = calls.length;
    expect(
      await sessions.open(project, first.document.id, "created", first),
    ).toBe(true);
    expect(calls.slice(before)).not.toContain("pages:get");
    expect(calls.slice(before)).not.toContain("drafts:list");
    expect(sessions.getSnapshot().active?.getSnapshot().draft?.id).toBe(
      first.document.id,
    );
  });
  afterEach(async () => {
    await sessions.shutdown();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  async function warm() {
    await sessions.open(project, first.document.id, "a");
    const a = sessions.getSnapshot().active!;
    await sessions.open(project, second.document.id, "b");
    await sessions.open(project, first.document.id, "a");
    return a;
  }
  it("joins an accepted asynchronous Undo while its own Native publication save remains acyclic",async()=>{
    const page=await warm(),owner=sourceSessionFor(page.getSnapshot().draft!)!,queue=new HistoryTravelQueue(owner),gate=deferred(),entered=deferred();
    const travel=queue.enqueue(async()=>{
      page.edit({title:"actual publication before Undo"});
      expect(await page.flushPublishedSource()).toBe(true);
      entered.release();await gate.promise;
      page.edit({title:"actual completed Undo"});
    });
    let saved=false;const flush=page.flush().then(result=>{saved=result;return result});
    await entered.promise;expect(saved).toBe(false);expect(page.isDirty()).toBe(true);expect(page.isBusy()).toBe(true);
    gate.release();await travel;expect(await flush).toBe(true);
    const disk=await invoke<LoadedPage>("pages:get",{projectId:project,pageId:first.document.id});
    expect(disk.document.title).toBe("actual completed Undo");expect(page.isDirty()).toBe(false);await queue.close();
  });
  it("keeps the actual owner alive through a pending travel during disposal and durably retains its final source",async()=>{
    const page=await warm(),owner=sourceSessionFor(page.getSnapshot().draft!)!,queue=new HistoryTravelQueue(owner),gate=deferred(),entered=deferred();
    const travel=queue.enqueue(async()=>{entered.release();await gate.promise;page.edit(owner.replace({...owner.document!,title:"accepted Undo completed while retiring"}))});
    await entered.promise;let disposed=false;const retiring=page.dispose().then(()=>{disposed=true});
    await Promise.resolve();expect(disposed).toBe(false);expect(owner.disposed).toBe(false);
    gate.release();await travel;await retiring;expect(owner.disposed).toBe(true);
    const drafts=await invoke<{id:string}[]>("drafts:list",{projectId:project,resourceId:first.document.id});expect(drafts.length).toBeGreaterThan(0);
    const read=await invoke<{content:ContainerDocument}>("drafts:read",{id:drafts[0].id});expect(read.content.title).toBe("accepted Undo completed while retiring");
    await queue.close();
  });
  it("serializes accepted trips from separate mounted views of the same actual source",async()=>{
    const page=await warm(),owner=sourceSessionFor(page.getSnapshot().draft!)!,one=new HistoryTravelQueue(owner),two=new HistoryTravelQueue(owner),gate=deferred(),entered=deferred(),steps:string[]=[];
    const firstWork=one.enqueue(async()=>{steps.push("first began");entered.release();await gate.promise;page.edit({title:"first view completed"});steps.push("first published")});
    const secondWork=two.enqueue(async()=>{expect(page.getSnapshot().draft!.title).toBe("first view completed");page.edit({title:"second view completed"});steps.push("second published")});
    await entered.promise;expect(steps).toEqual(["first began"]);const flush=page.flush();gate.release();await Promise.all([firstWork,secondWork]);expect(await flush).toBe(true);
    expect(steps).toEqual(["first began","first published","second published"]);const disk=await invoke<LoadedPage>("pages:get",{projectId:project,pageId:first.document.id});expect(disk.document.title).toBe("second view completed");await one.close();await two.close();
  });
  it.each(["reload","copy"] as const)("retains an uncertain failed Undo and recovers through actual %s without replay",async recovery=>{
    const page=await warm(),owner=sourceSessionFor(page.getSnapshot().draft!)!,queue=new HistoryTravelQueue(owner),failure=new Error("inverse committed, actual response unavailable");let inverses=0;
    await expect(queue.enqueue(async()=>{inverses++;page.edit({title:"actual known recovery body"});await page.flushPublishedSource();throw failure})).rejects.toBe(failure);
    await expect(page.flush()).rejects.toBe(failure);
    expect(page.getSnapshot().status).toBe("error");expect(page.getSnapshot().error).toContain(failure.message);expect(page.isDurable()).toBe(false);
    const retained=page.getSnapshot().availableDrafts[0]!;
    const actual=await invoke<{content:ContainerDocument}>("drafts:read",{id:retained.id});expect(actual.content.title).toBe("actual known recovery body");
    await expect(page.retry()).rejects.toBe(failure);expect(inverses).toBe(1);
    const anotherView=new HistoryTravelQueue(owner);await expect(anotherView.enqueue(async()=>{inverses++})).rejects.toBe(failure);expect(inverses).toBe(1);
    if(recovery==="reload")await page.reload();else expect(await page.keepCopy()).not.toBeNull();
    const fresh=sourceSessionFor(page.getSnapshot().draft!)!;expect(fresh).not.toBe(owner);expect(page.getSnapshot().status).toBe("saved");
    const retainedAfter=await invoke<{content:ContainerDocument}>("drafts:read",{id:retained.id});expect(retainedAfter.content.title).toBe("actual known recovery body");
    const next=new HistoryTravelQueue(fresh);await next.enqueue(async()=>{page.edit({title:"new owned action after recovery"})});expect(await page.flush()).toBe(true);
    expect(inverses).toBe(1);await next.close();
  });
  it("retires a moved page's retained editors and reloads its destination on reopen", async () => {
    const originalSession = await warm();
    await sessions.open(project, second.document.id, "b");
    const otherSession = sessions.getSnapshot().active;
    expect(await sessions.flushAll()).toBe(true);
    const destination = await invoke<{ id: string }>("folders:create", {
      projectId: project,
      name: "Destination",
    });
    const record = await invoke<LoadedPage>("pages:get", {
      projectId: project,
      pageId: first.document.id,
    });
    await invoke("sidebar:moveEntry", {
      kind: "page",
      projectId: project,
      destinationProjectId: project,
      id: first.document.id,
      parentId: destination.id,
      baseHash: record.hash,
      baseRevision: record.revision,
    });
    sessions.forgetPage(project, first.document.id);
    expect(
      sessions
        .getSnapshot()
        .views.some((view) => view.session === originalSession),
    ).toBe(false);
    expect(sessions.getSnapshot().active).toBe(otherSession);
    expect(await sessions.open(project, first.document.id, "a")).toBe(true);
    expect(sessions.getSnapshot().active).not.toBe(originalSession);
    expect(sessions.getSnapshot().active?.getSnapshot().draft?.parentId).toBe(
      destination.id,
    );
  });
  it("keeps unsaved editors when asked to forget a page", async () => {
    await sessions.open(project, first.document.id, "a");
    const active = sessions.getSnapshot().active!;
    active.edit({ title: "Unsaved title" });
    expect(() => sessions.forgetPage(project, first.document.id)).toThrow(
      "Save the page",
    );
    expect(sessions.getSnapshot().active).toBe(active);
    expect(await sessions.flushAll()).toBe(true);
    sessions.forgetPage(project, first.document.id);
    expect(sessions.getSnapshot().active).toBeNull();
    expect(sessions.getSnapshot().views).toHaveLength(0);
  });
  it("does not restore an unchanged retained draft over a newer formal page", async () => {
    const retained = await invoke<{ id: string }>("drafts:save", {
      input: {
        kind: "page",
        clientId: "workspace-test-client",
        projectId: project,
        resourceId: first.document.id,
        baseRevision: first.revision,
        baseContent: first.document,
        content: first.document,
        sequence: 1,
      },
    });
    const remote = await invoke<LoadedPage>("pages:save", {
      projectId: project,
      pageId: first.document.id,
      document: { ...first.document, title: "New formal content" },
      baseHash: first.hash,
      baseRevision: first.revision,
    });
    await sessions.open(project, first.document.id, "a");
    const view = sessions.getSnapshot().active!;
    expect(view.getSnapshot().status).toBe("saved");
    expect(view.getSnapshot().draft).toEqual(remote.document);
    const remaining = await invoke<{ id: string }[]>("drafts:list", {
      projectId: project,
      resourceId: first.document.id,
    });
    expect(remaining.some((item) => item.id === retained.id)).toBe(false);
  });
  async function saveForeignDraft(content:LoadedPage["document"],clientId="previous-window",baseContent:LoadedPage["document"]|null=first.document,sequence=2){
    return invoke<import("../core/editor-drafts").EditorDraftRecord>("drafts:save",{input:{kind:"page",clientId,projectId:project,resourceId:first.document.id,
      ...(baseContent?{baseRevision:first.revision,baseContent}:{}),content,sequence}});
  }
  async function expectRetained(id:string,content:LoadedPage["document"]){
    const stored=await invoke<{content:LoadedPage["document"]}>("drafts:read",{id});expect(stored.content).toEqual(content);
  }
  it("hides another window's saved copy while retaining its exact original body",async()=>{
    const body={...first.document,createdAt:"2000-01-01T00:00:00.000Z",updatedAt:"2001-01-01T00:00:00.000Z"};
    const retained=await saveForeignDraft(body);await sessions.open(project,first.document.id,"a");
    const view=sessions.getSnapshot().active!;expect(view.getSnapshot().availableDrafts).toEqual([]);expect(view.getSnapshot().draft).toEqual(first.document);
    await expectRetained(retained.id,body);expect(view.getSnapshot().status).toBe("saved");
  });
  it("hides an unedited old baseline without replacing a newer formal page",async()=>{
    const retained=await saveForeignDraft(first.document);
    const remote=await invoke<LoadedPage>("pages:save",{projectId:project,pageId:first.document.id,document:{...first.document,title:"Newer formal page"},baseHash:first.hash,baseRevision:first.revision});
    await sessions.open(project,first.document.id,"a");const view=sessions.getSnapshot().active!;
    expect(view.getSnapshot().availableDrafts).toEqual([]);expect(view.getSnapshot().draft).toEqual(remote.document);await expectRetained(retained.id,first.document);
  });
  it("hides edits already present alongside later independent formal additions",async()=>{
    const body=structuredClone(first.document);body.content.content!.push({type:"paragraph",attrs:{id:crypto.randomUUID()},content:[{type:"text",text:"Retained human text"}]});
    const retained=await saveForeignDraft(body);const remote=structuredClone(body);remote.content.content!.push({type:"paragraph",attrs:{id:crypto.randomUUID()},content:[{type:"text",text:"Later Agent text"}]});
    const saved=await invoke<LoadedPage>("pages:save",{projectId:project,pageId:first.document.id,document:remote,baseHash:first.hash,baseRevision:first.revision});
    await sessions.open(project,first.document.id,"a");const view=sessions.getSnapshot().active!;
    expect(view.getSnapshot().availableDrafts).toEqual([]);expect(view.getSnapshot().draft).toEqual(saved.document);
    await expectRetained(retained.id,body);expect((await invoke<LoadedPage>("pages:get",{projectId:project,pageId:first.document.id})).revision).toBe(saved.revision);
  });
  it("offers genuine unsaved drafts and conflicts without changing any source",async()=>{
    const body={...first.document,title:"Unsaved human title"},legacy={...first.document,title:"Uncertain draft without a baseline"};
    const one=await saveForeignDraft(body),two=await saveForeignDraft(legacy,"older-version",null);
    const remote=await invoke<LoadedPage>("pages:save",{projectId:project,pageId:first.document.id,document:{...first.document,title:"Concurrent formal title"},baseHash:first.hash,baseRevision:first.revision});
    await sessions.open(project,first.document.id,"a");const view=sessions.getSnapshot().active!;expect(new Set(view.getSnapshot().availableDrafts.map(x=>x.id))).toEqual(new Set([one.id,two.id]));
    expect(view.getSnapshot().draft).toEqual(remote.document);await expectRetained(one.id,body);await expectRetained(two.id,legacy);
  });
  it("checks the generation actually read when another window updates during inspection",async()=>{
    const retained=await saveForeignDraft(first.document),entered=deferred(),gate=deferred(),backend=invoke;
    const observer=new PageSessions({clientId:"checking-window",saveDelayMs:50,draftDelayMs:20,invoke:async<T>(action:string,args?:Record<string,unknown>)=>{
      if(action==="drafts:read"&&args?.id===retained.id){entered.release();await gate.promise;}return backend<T>(action,args);
    }});observer.setHome(home);
    try{
      const opening=observer.open(project,first.document.id,"a");await entered.promise;const body={...first.document,title:"Actually newer unsaved text"};const newer=await saveForeignDraft(body,"previous-window",first.document,3);gate.release();await opening;
      expect(observer.getSnapshot().active!.getSnapshot().availableDrafts.map(x=>[x.id,x.generation])).toEqual([[newer.id,newer.generation]]);await expectRetained(newer.id,body);
    }finally{gate.release();await observer.shutdown();}
  });
  it("retains the hint and original files when the actual stored body cannot be read",async()=>{
    const body={...first.document,title:"Intact source before a disk error"},retained=await saveForeignDraft(body);
    const file=join(home,"local","editor-drafts",retained.id,retained.generation,retained.path),original=await readFile(file),broken=Buffer.from("{incomplete disk write");
    await writeFile(file,broken);await sessions.open(project,first.document.id,"a");const view=sessions.getSnapshot().active!;
    expect(view.getSnapshot().availableDrafts.map(x=>x.id)).toContain(retained.id);expect(view.getSnapshot().error).not.toBe("");expect(await readFile(file)).toEqual(broken);
    expect(view.getSnapshot().draft).toEqual(first.document);await writeFile(file,original);await expectRetained(retained.id,body);
  });
  it("keeps edits typed while foreign drafts are being checked",async()=>{
    const retained=await saveForeignDraft(first.document),entered=deferred(),gate=deferred(),backend=invoke;
    const view=createPageSession({clientId:"typing-during-check",sourceHomeId:home,saveDelayMs:50,draftDelayMs:20,invoke:async<T>(action:string,args?:Record<string,unknown>)=>{
      if(action==="drafts:read"&&args?.id===retained.id){entered.release();await gate.promise;}return backend<T>(action,args);
    }});
    try{const opening=view.open(project,first.document.id);await entered.promise;view.edit({title:"Typed during comparison"});expect(await view.flush()).toBe(true);gate.release();await opening;
      expect(view.getSnapshot().draft?.title).toBe("Typed during comparison");expect((await invoke<LoadedPage>("pages:get",{projectId:project,pageId:first.document.id})).document.title).toBe("Typed during comparison");await expectRetained(retained.id,first.document);
    }finally{gate.release();await view.dispose();}
  });
  it("does not erase empty arrays inside actual custom or future data",async()=>{
    const body={...first.document,futureData:{content:[]}},retained=await saveForeignDraft(body);
    await sessions.open(project,first.document.id,"a");expect(sessions.getSnapshot().active!.getSnapshot().availableDrafts.map(x=>x.id)).toContain(retained.id);await expectRetained(retained.id,body);
  });
  it("rechecks recovery hints after a later save includes the retained edit",async()=>{
    const body={...first.document,title:"Previously unsaved text"},retained=await saveForeignDraft(body);
    await sessions.open(project,first.document.id,"a");const view=sessions.getSnapshot().active!;expect(view.getSnapshot().availableDrafts.map(x=>x.id)).toContain(retained.id);
    view.edit({title:body.title});expect(await view.flush()).toBe(true);
    await expect.poll(()=>view.getSnapshot().availableDrafts.length).toBe(0);await expectRetained(retained.id,body);
  });
  it.each([false, true])(
    "rebases a retained typing draft on Agent additions when reopening (already synced: %s)",
    async (alreadySynced) => {
      const local = structuredClone(first.document);
      const typed: JSONContent = {
        type: "paragraph",
        attrs: { id: crypto.randomUUID() },
        content: [
          { type: "text", text: "Human draft after switching runtime" },
        ],
      };
      local.content.content!.push(typed);
      await invoke("drafts:save", {
        input: {
          kind: "page",
          clientId: "workspace-test-client",
          projectId: project,
          resourceId: first.document.id,
          baseRevision: first.revision,
          baseContent: first.document,
          content: local,
          sequence: 2,
        },
      });
      const remote = structuredClone(first.document);
      remote.content.content!.push({
        type: "paragraph",
        attrs: { id: crypto.randomUUID() },
        content: [
          { type: "text", text: "Agent addition while page was closed" },
        ],
      });
      if (alreadySynced) remote.content.content!.push(typed);
      await invoke("pages:save", {
        projectId: project,
        pageId: first.document.id,
        document: remote,
        baseHash: first.hash,
        baseRevision: first.revision,
      });
      await sessions.open(project, first.document.id, "reopened");
      const view = sessions.getSnapshot().active!;
      expect(view.getSnapshot().status).not.toBe("conflict");
      expect(await view.flush()).toBe(true);
      const saved = await invoke<LoadedPage>("pages:get", {
        projectId: project,
        pageId: first.document.id,
      });
      const texts = saved.document.content.content!.flatMap(
        (n) => n.content?.map((child) => child.text) ?? [],
      );
      expect(
        texts.filter((text) => text === "Human draft after switching runtime"),
      ).toHaveLength(1);
      expect(texts).toContain("Agent addition while page was closed");
      expect(view.getSnapshot().status).toBe("saved");
      expect(
        await invoke("drafts:list", {
          kind: "page",
          projectId: project,
          resourceId: first.document.id,
        }),
      ).toEqual([]);
    },
  );
  it("saves nested unusable links as text while keeping the exact original recovery draft", async () => {
    const view = await warm();
    const content = structuredClone(view.getSnapshot().draft!.content);
    const find = (node: JSONContent): JSONContent | undefined =>
      node.type === "paragraph" ? node : node.content?.map(find).find(Boolean);
    find(content)!.content = [
      {
        type: "text",
        text: "Preserve every word",
        marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
      },
    ];
    view.editContent(content);
    expect(await view.flush()).toBe(true);
    const saved = await invoke<LoadedPage>("pages:get", {
      projectId: project,
      pageId: first.document.id,
    });
    expect(JSON.stringify(saved.document)).toContain("Preserve every word");
    expect(JSON.stringify(saved.document)).not.toContain("javascript:");
    const drafts = view.getSnapshot().availableDrafts;
    const recovery = drafts.find((item) =>
      item.clientId.includes(":link-recovery:"),
    )!;
    expect(recovery).toBeDefined();
    const original = await invoke<{ content: unknown }>("drafts:read", {
      id: recovery.id,
    });
    expect(JSON.stringify(original.content)).toContain("javascript:alert(1)");
  });
  it("merges independent live Agent changes with human typing without stopping the editor", async () => {
    const view = await warm();
    const content = structuredClone(view.getSnapshot().draft!.content);
    const find = (node: JSONContent): JSONContent | undefined =>
      node.type === "paragraph" ? node : node.content?.map(find).find(Boolean);
    find(content)!.content = [{ type: "text", text: "Human typing continues" }];
    view.editContent(content);
    await invoke("pages:save", {
      projectId: project,
      pageId: first.document.id,
      document: { ...first.document, title: "Agent updated the title" },
      baseHash: first.hash,
      baseRevision: first.revision,
    });
    await view.refresh();
    expect(await view.flush()).toBe(true);
    const saved = await invoke<LoadedPage>("pages:get", {
      projectId: project,
      pageId: first.document.id,
    });
    expect(saved.document.title).toBe("Agent updated the title");
    expect(JSON.stringify(saved.document.content)).toContain(
      "Human typing continues",
    );
    expect(view.getSnapshot().status).toBe("saved");
  });
  it("keeps both real versions when worker merging encounters incompatible title edits",async()=>{
    const view=await warm();
    view.edit({title:"Local title waiting for save"});
    await invoke("pages:save",{
      projectId:project,pageId:first.document.id,
      document:{...first.document,title:"Remote title already saved"},
      baseHash:first.hash,baseRevision:first.revision,
    });
    await view.refresh();
    expect(view.getSnapshot().status).toBe("conflict");
    expect(view.getSnapshot().draft!.title).toBe("Local title waiting for save");
    expect(await view.flush()).toBe(false);
    const saved=await invoke<LoadedPage>("pages:get",{projectId:project,pageId:first.document.id});
    expect(saved.document.title).toBe("Remote title already saved");
    await view.retainDraft();
    const retained=await invoke<{id:string}[]>("drafts:list",{kind:"page",projectId:project,resourceId:first.document.id});
    expect(retained.length).toBeGreaterThan(0);
  });
  it("saves a reviewed merge through the workbench page:mergeSave action",async()=>{
    const view=await warm();
    view.edit({title:"Local title waiting for save"});
    await invoke("pages:save",{
      projectId:project,pageId:first.document.id,
      document:{...first.document,title:"Remote title already saved"},
      baseHash:first.hash,baseRevision:first.revision,
    });
    await view.refresh();
    const {status,draft,mergeBase}=view.getSnapshot();
    expect(status).toBe("conflict");
    const preview=await invoke<{conflicts:unknown[];currentRevision:string;currentHash:string}>("page:mergePreview",{
      projectId:project,pageId:first.document.id,baseRevision:mergeBase,document:draft,
    });
    expect(preview.conflicts.length).toBeGreaterThan(0);
    view.prepareResolution({...draft!,title:"Reviewed merged title"},preview.currentRevision,preview.currentHash);
    expect(view.getSnapshot().reviewingConflict).toBe(true);
    calls.length=0;
    expect(await view.retry()).toBe(true);
    expect(calls).toContain("page:mergeSave");
    const saved=await invoke<LoadedPage>("pages:get",{projectId:project,pageId:first.document.id});
    expect(saved.document.title).toBe("Reviewed merged title");
    expect(saved.revision).not.toBe(preview.currentRevision);
    expect(view.getSnapshot()).toMatchObject({status:"saved",reviewingConflict:false});
  });
  it("saves a reviewed external conflict resolution through the workbench workspace:resolve action",async()=>{
    const view=await warm();
    await writeFile(first.path,serializeArtifact({...first.document,title:"External file edit"}));
    view.edit({title:"Local edit beside the external file"});
    expect(await view.flush()).toBe(false);
    const {status,draft,conflictId}=view.getSnapshot();
    expect(status).toBe("conflict");
    expect(conflictId).toBeDefined();
    const detail=await invoke<{external:string|null}>("workspace:conflict",{id:conflictId});
    expect(detail.external).toContain("External file edit");
    view.prepareExternalResolution({...draft!,title:"Reviewed external resolution"},conflictId!);
    expect(view.getSnapshot().reviewingConflict).toBe(true);
    calls.length=0;
    expect(await view.retry()).toBe(true);
    expect(calls).toContain("workspace:resolve");
    const saved=await invoke<LoadedPage>("pages:get",{projectId:project,pageId:first.document.id});
    expect(saved.document.title).toBe("Reviewed external resolution");
    expect(saved.workspaceConflicts).toBeUndefined();
    expect(await invoke("workspace:conflicts",{projectId:project})).toEqual([]);
    expect(view.getSnapshot()).toMatchObject({status:"saved",reviewingConflict:false,conflictId:undefined});
  });
  it("leaves a page blocked by an external conflict with its edits kept in the local draft",async()=>{
    const view=await warm();
    await writeFile(first.path,serializeArtifact({...first.document,title:"External file edit"}));
    view.edit({title:"Local edit kept while away"});
    expect(await view.flush()).toBe(false);
    expect(view.getSnapshot().status).toBe("conflict");
    // The workbench may leave a conflicted page; leaving retains the draft.
    expect(await sessions.open(project,second.document.id,"b")).toBe(true);
    expect(sessions.getSnapshot().active?.getSnapshot().draft?.id).toBe(second.document.id);
    const drafts=await invoke<{title:string}[]>("drafts:list",{kind:"page",projectId:project,resourceId:first.document.id});
    expect(drafts.map(draft=>draft.title)).toContain("Local edit kept while away");
    expect(await sessions.open(project,first.document.id,"a")).toBe(true);
    expect(sessions.getSnapshot().active?.getSnapshot()).toMatchObject({status:"conflict",draft:{title:"Local edit kept while away"}});
  });
  it("keeps every open tab resident, including duplicate pages beyond the history budget", async () => {
    await warm();
    calls.length = 0;
    await sessions.open(project, second.document.id, "b");
    await sessions.open(project, first.document.id, "a");
    expect(calls).toEqual([]);
    expect(sessions.getSnapshot().views).toHaveLength(2);
    expect(sessions.getSnapshot().views.map((view) => view.tabId)).toEqual([
      "a",
      "b",
    ]);
    const a = sessions.getSnapshot().views.find((view) => view.tabId === "a")!;
    a.surface.history = {
      past: [first.document as ContainerDocument],
      future: [],
      group: "typing",
      at: 1,
    };
    await sessions.open(project, first.document.id, "c");
    expect(
      sessions.getSnapshot().views.find((view) => view.tabId === "a")!.surface
        .history!.past,
    ).toHaveLength(1);
    expect(
      sessions.getSnapshot().views.find((view) => view.tabId === "c")!.surface
        .history,
    ).toBeUndefined();
    expect(await sessions.closeTab("c")).toBe(true);
    expect(
      sessions.getSnapshot().views.some((view) => view.tabId === "c"),
    ).toBe(false);
    await sessions.open(project, second.document.id, "d");
    await sessions.open(project, second.document.id, "e");
    await sessions.open(project, second.document.id, "f");
    await sessions.open(project, second.document.id, "g");
    expect(sessions.getSnapshot().views).toHaveLength(6);
    expect(
      sessions.getSnapshot().views.some((view) => view.tabId === "a"),
    ).toBe(true);
    await sessions.open(project, first.document.id, "a");
    expect(
      sessions.getSnapshot().views.find((view) => view.tabId === "a")!.surface
        .history!.past,
    ).toHaveLength(1);
  });
  it("evicts navigation history before a tab's current page, even over the byte budget", async () => {
    await sessions.shutdown();
    sessions = new PageSessions({
      clientId: "bounded-history",
      invoke,
      maximumViews: 1,
      maximumViewBytes: 1,
    });
    sessions.setHome(home);
    await sessions.open(project, first.document.id, "a");
    const firstView = sessions.getSnapshot().views[0];
    await sessions.open(project, second.document.id, "b");
    expect(sessions.getSnapshot().views).toHaveLength(2);
    expect(sessions.getSnapshot().views[0]).toBe(firstView);
    await sessions.open(project, second.document.id, "a");
    expect(sessions.getSnapshot().views.map((view) => view.tabId)).toEqual([
      "b",
      "a",
    ]);
    expect(await sessions.closeTab("b")).toBe(true);
    expect(sessions.getSnapshot().views.map((view) => view.tabId)).toEqual([
      "a",
    ]);
  });
  it("shares untouched UI nodes after the real writer stamps canonical ink metadata", async () => {
    await sessions.open(project,first.document.id,"a");
    const view=sessions.getSnapshot().active!;
    let page:import("../types").ShowDocument=createResource(first.document,"board");
    page=addNode(page,{type:"drawing",attrs:{id:"new-ink",tool:"pen",color:"#111111",strokeWidth:2,extent:[100,60],points:[{x:0,y:0},{x:80,y:40}],ink:createPortableInk([{x:0,y:0,pressure:.5},{x:80,y:40,pressure:.8}],2,[100,60])}},
      {x:0,y:0,width:100,height:60},page.content.attrs!.id);
    page=addNode(page,{type:"drawing",attrs:{id:"unchanged-shape",tool:"rectangle",color:"#111111",strokeWidth:2,extent:[100,60],points:[{x:0,y:0},{x:100,y:60}]}},
      {x:200,y:0,width:100,height:60},page.content.attrs!.id);
    const ui=reconcileSurface(page),external=findSurfaceNode(ui,"unchanged-shape")!.node;
    view.edit({content:ui.content,layout:ui.layout,surfaceViews:ui.surfaceViews});
    const captured=view.getSnapshot().draft!,unchanged=findSurfaceNode(captured,"unchanged-shape")!.node;
    expect(unchanged).not.toBe(external);
    expect(await view.flush()).toBe(true);
    const installed=view.getSnapshot().draft!;
    expect(installed.content.attrs!.inkState).toBeDefined();
    expect(findSurfaceNode(installed,"unchanged-shape")!.node).toBe(unchanged);
    expect(installed.layout!["unchanged-shape"]).toBe(captured.layout!["unchanged-shape"]);
    const saved=await invoke<LoadedPage>("pages:get",{projectId:project,pageId:first.document.id});
    expect(installed).toEqual(saved.document);
  });
  it("captures external mutable drafts and exposes a readonly canonical source",async()=>{
    const view=await warm();
    const input={nested:{label:"captured",values:[1,2,3]}};
    view.edit({...view.getSnapshot().draft!,futurePayload:input} as import("../types").ShowDocument);
    const canonical=view.getSnapshot().draft!;
    expect(Object.isFrozen(canonical)).toBe(true);
    expect(Object.isFrozen((canonical as unknown as {futurePayload:typeof input}).futurePayload.nested)).toBe(true);
    input.nested.label="mutated after command";input.nested.values.push(4);
    expect((canonical as unknown as {futurePayload:typeof input}).futurePayload.nested).toEqual({label:"captured",values:[1,2,3]});
    expect(()=>{canonical.title="invalid direct canonical write"}).toThrow(TypeError);
    expect(await view.flush()).toBe(true);
    const reopened=await invoke<LoadedPage>("pages:get",{projectId:project,pageId:canonical.id});
    expect((reopened.document as unknown as {futurePayload:typeof input}).futurePayload.nested).toEqual({label:"captured",values:[1,2,3]});
  });
  it("keeps N+1 UI source when an actual pending save acknowledges N", async () => {
    const view=await warm(),entered=deferred(),release=deferred();
    const held=withLibraryLock(home,async()=>{entered.release();await release.promise});
    await entered.promise;
    try{
      view.edit({title:"Native packet N"});
      const pending=view.flush();
      // Let the real save capture its immutable source while the writer is locked.
      while(view.getSnapshot().status!=="saving")await new Promise(resolve=>setTimeout(resolve,1));
      view.edit({title:"Native packet N+1"});
      release.release();await held;expect(await pending).toBe(true);
      expect(view.getSnapshot().draft!.title).toBe("Native packet N+1");
      expect(await view.flush()).toBe(true);
      const saved=await invoke<LoadedPage>("pages:get",{projectId:project,pageId:first.document.id});
      expect(saved.document.title).toBe("Native packet N+1");
    }finally{release.release();await held}
  });
  it("retains locally and switches while the actual database writer is busy", async () => {
    const a = await warm();
    const entered = deferred(),
      release = deferred();
    const held = withLibraryLock(home, async () => {
      entered.release();
      await release.promise;
    });
    await entered.promise;
    try {
      a.edit({ title: "Saved in background" });
      await sessions.open(project, second.document.id, "b");
      expect(a.isDurable()).toBe(true);
      expect(a.getSnapshot().status).toBe("saving");
      expect(sessions.getSnapshot().active!.getSnapshot().draft!.title).toBe(
        "Second",
      );
      expect(await sessions.prepareClose()).toBe(true);
    } finally {
      release.release();
      await held;
    }
    expect(await sessions.flushAll()).toBe(true);
    expect(
      (
        await invoke<LoadedPage>("pages:get", {
          projectId: project,
          pageId: first.document.id,
        })
      ).document.title,
    ).toBe("Saved in background");
    expect(sessions.getSnapshot().active!.getSnapshot().draft!.title).toBe(
      "Second",
    );
  });
  it("preserves a failed inactive save and restores its real draft on reopening", async () => {
    const a = await warm();
    const entered = deferred(),
      release = deferred();
    const held = withLibraryLock(home, async () => {
      entered.release();
      await release.promise;
    });
    await entered.promise;
    try {
      a.edit({ title: "My retained edit" });
      // A close blocked now can name the page and export its unsaved source.
      const unsaved = sessions.unsavedPages();
      expect(unsaved.map((page) => [page.pageId, page.title])).toEqual([
        [first.document.id, "My retained edit"],
      ]);
      expect(JSON.parse(unsaved[0].source!).document.title).toBe(
        "My retained edit",
      );
      await sessions.open(project, second.document.id, "b");
      await writeFile(
        first.path,
        serializeArtifact({ ...first.document, title: "External file edit" }),
      );
    } finally {
      release.release();
      await held;
    }
    expect(await sessions.flushAll()).toBe(false);
    // A development reload names the page whose formal save is held, and why.
    const reload = await sessions.reloadResult();
    expect(reload).toMatchObject({ allow: false });
    const holding = (
      reload as { blockers: { pageId?: string; code: string }[] }
    ).blockers;
    expect(holding.map((blocker) => blocker.pageId)).toEqual([
      first.document.id,
    ]);
    expect(["PAGE_CONFLICT", "PAGE_NOT_SAVED"]).toContain(holding[0].code);
    expect(
      sessions
        .getSnapshot()
        .issues.some((issue) => issue.pageId === first.document.id),
    ).toBe(true);
    expect(sessions.getSnapshot().active!.getSnapshot().draft!.title).toBe(
      "Second",
    );
    expect(await sessions.prepareClose()).toBe(true);
    // The draft is retained, so closing the window is allowed.
    expect(await sessions.closeResult()).toBe(true);
    await sessions.shutdown();
    sessions = new PageSessions({ clientId: "workspace-test-client", invoke });
    sessions.setHome(home);
    await sessions.open(project, first.document.id, "restored");
    expect(sessions.getSnapshot().active!.getSnapshot().draft!.title).toBe(
      "My retained edit",
    );
    expect(sessions.getSnapshot().active!.getSnapshot().status).toBe(
      "conflict",
    );
  });
  it("does not notify the workspace metadata for every body keystroke", async () => {
    const a = await warm();
    let updates = 0;
    const stop = sessions.subscribe(() => {
      updates++;
    });
    for (let index = 0; index < 10; index++) {
      const content = structuredClone(a.getSnapshot().draft!.content);
      const find = (node: JSONContent): JSONContent | undefined =>
        node.type === "paragraph"
          ? node
          : node.content?.map(find).find(Boolean);
      const text = find(content)!;
      text.content = [{ type: "text", text: `typed ${index}` }];
      a.editContent(content);
      await Promise.resolve();
    }
    stop();
    expect(updates).toBe(1);
    expect(JSON.stringify(a.getSnapshot().draft!.content)).toContain("typed 9");
    expect(await sessions.flushAll()).toBe(true);
  });
  it("does not discard a draft on an unprepared content-library switch", async () => {
    const a = await warm();
    a.edit({ title: "Retain before leaving" });
    expect(() => sessions.setHome(join(directory, "other-library"))).toThrow(
      "可靠保留",
    );
    expect(sessions.getSnapshot().active).toBe(a);
    expect(a.getSnapshot().draft!.title).toBe("Retain before leaving");
    expect(await sessions.flushAll()).toBe(true);
  });
});
