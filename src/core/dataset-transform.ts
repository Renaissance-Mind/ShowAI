import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  shouldInterruptAfterDeadline,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import releaseSync from "@jitl/quickjs-wasmfile-release-sync";
import { TRANSFORM_LIMITS } from "../datasets/dataset-file";
import { TRANSFORM_HELPERS_SOURCE } from "./dataset-transform-helpers";

// Transform datasets compute their value with a script an Agent wrote. The
// script runs in QuickJS compiled to WebAssembly: each run gets a fresh
// runtime with only the ECMAScript built-ins and the helpers (no files,
// network, timers or host objects), a memory limit and a deadline.

export { TRANSFORM_LIMITS };

/** The file name errors of the script point at. */
const SCRIPT_FILE = "transform.js";

export type TransformRun =
  | { ok: true; value: unknown; ms: number }
  | {
      ok: false;
      code: "TRANSFORM_FAILED" | "OUTPUT_INVALID" | "TOO_LARGE";
      message: string;
      line?: number;
      ms: number;
    };

/**
 * The WebAssembly file of QuickJS. Bundles resolve it from the node_modules
 * next to them (source checkout, dist-runtime); the packaged desktop main
 * process from the runtime shipped in its resources.
 */
async function wasmBinary(): Promise<ArrayBuffer> {
  const bases = [import.meta.url];
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (resources) bases.push(join(resources, "runtime", "scripts", "cli.mjs"));
  let problem: unknown;
  for (const base of bases) {
    let path: string;
    try {
      path = createRequire(base).resolve(
        "@jitl/quickjs-wasmfile-release-sync/wasm",
      );
    } catch (error) {
      problem = error;
      continue;
    }
    const bytes = await readFile(path);
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  }
  throw new Error(
    `The QuickJS runtime for dataset transforms is missing: ${problem instanceof Error ? problem.message : String(problem)}`,
  );
}

let compiled: Promise<WebAssembly.Module> | undefined;
let quickjs: Promise<QuickJSWASMModule> | undefined;
/**
 * The QuickJS engine. A run that exhausted its memory can leave the engine
 * unable to free its runtime; that engine is dropped and the next run
 * instantiates a new one from the compiled module.
 */
function engine(): Promise<QuickJSWASMModule> {
  if (!quickjs) {
    const wasm = (compiled ??= wasmBinary().then((bytes) =>
      WebAssembly.compile(bytes),
    ));
    quickjs = newQuickJSWASMModuleFromVariant(
      newVariant(releaseSync, { wasmModule: () => wasm }),
    ).catch((error) => {
      quickjs = undefined;
      if (compiled === wasm) compiled = undefined;
      throw error;
    });
  }
  return quickjs;
}

interface ErrorDump {
  name?: string;
  message?: string;
  stack?: string;
}

/** A readable message of a sandbox error and the script line it points at. */
function describe(dump: unknown): {
  name: string;
  message: string;
  line?: number;
} {
  if (!dump || typeof dump !== "object")
    return {
      name: "Error",
      message: `The script threw ${JSON.stringify(dump) ?? String(dump)}.`,
    };
  const error = dump as ErrorDump;
  const name = typeof error.name === "string" ? error.name : "Error";
  const message =
    typeof error.message === "string" ? error.message : JSON.stringify(dump);
  const match = new RegExp(`${SCRIPT_FILE.replace(".", "\\.")}:(\\d+)`).exec(
    error.stack ?? "",
  );
  return { name, message, ...(match ? { line: Number(match[1]) } : {}) };
}

/**
 * Runs transform(inputs, helpers) of the script on JSON inputs. Failures of
 * the script and invalid output are results, not exceptions.
 */
export async function runTransform(
  script: string,
  inputs: Record<string, unknown>,
): Promise<TransformRun> {
  const engineInUse = engine();
  const module = await engineInUse;
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(TRANSFORM_LIMITS.memoryBytes);
  runtime.setMaxStackSize(TRANSFORM_LIMITS.stackBytes);
  runtime.setInterruptHandler(
    shouldInterruptAfterDeadline(Date.now() + TRANSFORM_LIMITS.timeoutMs),
  );
  const context = runtime.newContext();
  const handles: QuickJSHandle[] = [];
  let broken = false;
  const keep = (handle: QuickJSHandle) => {
    handles.push(handle);
    return handle;
  };
  const failure = (
    error: QuickJSHandle,
    code: "TRANSFORM_FAILED" | "OUTPUT_INVALID",
  ): TransformRun => {
    keep(error);
    const { name, message, line } = describe(context.dump(error));
    if (name === "OutputInvalid")
      return { ok: false, code: "OUTPUT_INVALID", message, ms: elapsed() };
    const interrupted = /interrupted/i.test(message);
    const memory = /out of memory/i.test(message);
    return {
      ok: false,
      code,
      message: interrupted
        ? `The script ran longer than ${TRANSFORM_LIMITS.timeoutMs / 1000} s and was stopped.`
        : memory
          ? `The script used more than ${TRANSFORM_LIMITS.memoryBytes / 1024 / 1024} MiB of memory and was stopped.`
          : `${name}: ${message}${line ? ` (line ${line})` : ""}`,
      ...(line && !interrupted && !memory ? { line } : {}),
      ms: elapsed(),
    };
  };
  try {
    const prepared = context.evalCode(
      TRANSFORM_HELPERS_SOURCE,
      "showai-helpers.js",
    );
    if (prepared.error) return failure(prepared.error, "TRANSFORM_FAILED");
    const runner = keep(prepared.value);
    const loaded = context.evalCode(script, SCRIPT_FILE);
    if (loaded.error) return failure(loaded.error, "TRANSFORM_FAILED");
    keep(loaded.value);
    const text = keep(context.newString(JSON.stringify(inputs)));
    const called = context.callFunction(
      keep(context.getProp(runner, "run")),
      runner,
      text,
    );
    if (called.error) return failure(called.error, "TRANSFORM_FAILED");
    keep(called.value);
    const output = context.callFunction(
      keep(context.getProp(runner, "output")),
      runner,
    );
    if (output.error) return failure(output.error, "OUTPUT_INVALID");
    const json = context.getString(keep(output.value));
    if (Buffer.byteLength(json) > TRANSFORM_LIMITS.outputBytes)
      return {
        ok: false,
        code: "TOO_LARGE",
        message: `The output has ${Buffer.byteLength(json)} bytes; a dataset holds at most ${TRANSFORM_LIMITS.outputBytes} bytes.`,
        ms: elapsed(),
      };
    return { ok: true, value: JSON.parse(json), ms: elapsed() };
  } catch (error) {
    // Recursion can exhaust the host's stack before QuickJS's own limit;
    // the engine it interrupted is not reused.
    if (!(error instanceof RangeError)) throw error;
    broken = true;
    return {
      ok: false,
      code: "TRANSFORM_FAILED",
      message: "InternalError: stack overflow (calls nested too deeply)",
      ms: elapsed(),
    };
  } finally {
    try {
      for (const handle of handles.reverse())
        if (handle.alive) handle.dispose();
      context.dispose();
      runtime.dispose();
      if (broken && quickjs === engineInUse) quickjs = undefined;
    } catch {
      // QuickJS aborts freeing a runtime that ran out of memory; the
      // engine instance is discarded with everything it allocated.
      if (quickjs === engineInUse) quickjs = undefined;
    }
  }
}
