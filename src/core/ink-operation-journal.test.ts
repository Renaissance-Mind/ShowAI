import { afterEach, beforeAll, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { InkOperationJournal } from "./ink-operation-journal";
import { bootstrapInkOperation, createInkOperation, materializeInkOperations } from "../surface/ink-operations.mjs";
import { createPortableInk } from "../surface/portable-ink.mjs";

const roots: string[] = [], journals: InkOperationJournal[] = [];
const scope = { pageId: "page", boardId: "board" };
const frame = { x: 0, y: 0, width: 50, height: 30 };
const node = { type: "drawing", attrs: { id: "stroke", tool: "pen", color: "#111111", strokeWidth: 2, extent: [50, 30], ink: createPortableInk([{ x: 1, y: 2 }, { x: 30, y: 4 }], 2, [50, 30]) } };
const seed = () => bootstrapInkOperation({ ...scope, actor: "seed", nodes: [node], layout: { stroke: frame } })!;
async function temporary() { const root = await mkdtemp(join(process.env.SHOWAI_TEST_HOME ?? tmpdir(), "ink-journal-")); roots.push(root); return root; }
async function open(root: string, checkpointEvery = 128) { const journal = await InkOperationJournal.open(root, { checkpointEvery }); journals.push(journal); return journal; }
function close(journal: InkOperationJournal) { journal.close(); journals.splice(journals.indexOf(journal), 1); }
afterEach(async () => { for (const journal of journals.splice(0)) journal.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
beforeAll(async () => { if (process.env.SHOWAI_TEST_HOME) await mkdir(process.env.SHOWAI_TEST_HOME, { recursive: true }); });

async function compile(root: string) {
  const output = join(root, "journal-host.mjs");
  await build({ entryPoints: [join(import.meta.dirname, "ink-operation-journal.ts")], outfile: output, bundle: true, platform: "node", format: "esm", target: "node24" });
  return pathToFileURL(output).href;
}
async function child(script: string) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string }>((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    process.stdout.on("data", value => { output += value.toString(); });
    process.stderr.on("data", value => { output += value.toString(); });
    process.on("error", reject); process.on("close", (code, signal) => resolve({ code, signal, output }));
  });
}

it("durably stores editable strokes, reloads after close, and persists a unique device actor", async () => {
  const root = await temporary(), first = await open(root), actor = first.actor;
  expect(first.append([seed()])).toEqual({ appended: 1 });
  const edit = first.appendLocal({ ...scope, parents: ["seed:1"], changes: [{ kind: "edit", strokeId: "stroke", patch: { color: "#ff0000" } }] });
  expect(edit.actor).toBe(actor); expect(edit.sequence).toBe(1);
  close(first);
  const second = await open(root);
  expect(second.actor).toBe(actor);
  expect(second.read(scope).materialization!.strokes[0].node.attrs).toMatchObject({ color: "#ff0000", ink: node.attrs.ink });
  expect(second.operations(scope)).toEqual([seed(), edit]);
  const other = await open(await temporary()); expect(other.actor).not.toBe(actor);
});
it("does not append duplicates and rejects payload changes using an existing operation id", async () => {
  const journal = await open(await temporary());
  expect(journal.append([seed(), seed()])).toEqual({ appended: 1 });
  expect(journal.append([seed()])).toEqual({ appended: 0 });
  const fork = seed(); if (fork.changes[0].kind === "create") fork.changes[0].node.attrs!.color = "#ff0000";
  expect(() => journal.append([fork])).toThrow("collision");
  expect(journal.operations(scope)).toHaveLength(1);
});
it("a missing parent rolls back every scope in a multi-Board batch", async () => {
  const journal = await open(await temporary());
  const missing = createInkOperation({ actor: "ipad", sequence: 1, pageId: "another", boardId: "board", parents: ["missing:1"], changes: [{ kind: "delete", strokeId: "stroke" }] });
  expect(() => journal.append([seed(), missing])).toThrow("missing causal");
  expect(journal.operations(scope)).toEqual([]);
  expect(journal.read(scope).materialization).toBeNull();
});
it("checkpoints cap sample-payload replay while accepting delayed offline operations", async () => {
  const root = await temporary(), journal = await open(root, 2);
  journal.append([seed()]);
  const local = journal.appendLocal({ ...scope, parents: ["seed:1"], changes: [{ kind: "edit", strokeId: "stroke", patch: { color: "#ff0000" } }] });
  expect(journal.read(scope).operations).toEqual([]);
  expect(journal.read(scope).checkpoint).toBeDefined();
  const offline = createInkOperation({ actor: "web", sequence: 1, ...scope, parents: ["seed:1"], changes: [{ kind: "edit", strokeId: "stroke", patch: { color: "#0000ff" } }] });
  journal.append([offline]); close(journal);
  const reopened = await open(root, 2);
  expect(reopened.read(scope).materialization).toEqual(materializeInkOperations([seed(), local, offline]));
  expect(reopened.read(scope).materialization!.conflicts).toHaveLength(1);
  expect(reopened.operations(scope)).toHaveLength(3);
});
it("allocates actor sequences atomically across real concurrent host processes", async () => {
  const root = await temporary(), journal = await open(root, 16), module = await compile(root);
  journal.append([seed()]);
  const results = await Promise.all([0, 1, 2].map(writer => child(`
    import {InkOperationJournal} from ${JSON.stringify(module)};
    const journal=await InkOperationJournal.open(${JSON.stringify(root)},{checkpointEvery:16});
    for(let i=0;i<8;i++) journal.appendLocal({...${JSON.stringify(scope)},parents:['seed:1'],changes:[{kind:'edit',strokeId:'stroke',patch:{color:'#${writer}0'+String(i).padStart(4,'0')}}]});
    journal.close();
  `)));
  expect(results.map(result => [result.code, result.output])).toEqual(results.map(() => [0, ""]));
  const ops = journal.operations(scope);
  expect(ops).toHaveLength(25);
  expect(ops.filter(operation => operation.actor === journal.actor).map(operation => operation.sequence)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  expect(journal.read(scope).materialization!.conflicts).toEqual([]);
});
it.skipIf(process.platform === "win32")("recovers an uncommitted process death without exposing a partial event", async () => {
  const root = await temporary(), journal = await open(root), module = await compile(root);
  journal.append([seed()]);
  const childResult = await child(`
    import {DatabaseSync} from 'node:sqlite';
    const db=new DatabaseSync(${JSON.stringify(journal.path)});db.exec('BEGIN IMMEDIATE');
    db.prepare("INSERT INTO ink_operations(page_id,board_id,operation_id,actor,sequence,sha256,payload) VALUES(?,?,?,?,?,?,?)").run('page','board','incomplete:1','incomplete',1,'not-a-hash','not-json');
    process.kill(process.pid,'SIGKILL');
  `);
  expect(childResult.signal).toBe("SIGKILL");
  expect(journal.operations(scope)).toEqual([seed()]);
  const committed = await child(`
    import {InkOperationJournal} from ${JSON.stringify(module)};
    const journal=await InkOperationJournal.open(${JSON.stringify(root)});
    journal.appendLocal({...${JSON.stringify(scope)},parents:['seed:1'],changes:[{kind:'delete',strokeId:'stroke'}]});
    process.kill(process.pid,'SIGKILL');
  `);
  expect(committed.signal).toBe("SIGKILL"); close(journal);
  const recovered = await open(root);
  expect(recovered.operations(scope)).toHaveLength(2);
  expect(recovered.read(scope).materialization!.strokes[0].deleted).toBe(true);
});
it("reports committed source corruption explicitly instead of skipping a stroke", async () => {
  const journal = await open(await temporary()); journal.append([seed()]);
  const db = new DatabaseSync(journal.path);
  db.prepare("UPDATE ink_operations SET payload=? WHERE operation_id=?").run("{}", "seed:1"); db.close();
  expect(() => journal.read(scope)).toThrow("checksum mismatch");
  expect(() => journal.operations(scope)).toThrow("checksum mismatch");
});
it("reports corrupted checkpoint data while retaining original source operations", async () => {
  const journal = await open(await temporary()); journal.append([seed()]); journal.checkpoint(scope);
  const db = new DatabaseSync(journal.path);
  db.prepare("UPDATE ink_checkpoints SET payload='{}'").run(); db.close();
  expect(() => journal.read(scope)).toThrow("checkpoint checksum mismatch");
  expect(journal.operations(scope)).toEqual([seed()]);
});
