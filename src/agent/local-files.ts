import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { CoreError } from "../core/model";
import { CapacityError } from "../portable/capacity.mjs";

/**
 * File inputs and outputs of local MCP connections. Large tool arguments
 * (page operations, dataset values, component packages) can be read from a
 * file on this device instead of being copied into the call, and large reads
 * can be written to a file instead of being returned. Hosted connections run
 * elsewhere and never accept device paths.
 */

/** Absolute path check with the argument name in the message. */
export function assertLocalPath(path: unknown, field: string): string {
  if (typeof path !== "string" || !path.trim() || !isAbsolute(path))
    throw new CoreError(
      "INVALID_PATH",
      `${field} must be an absolute file path on this device, got ${JSON.stringify(path)}.`,
    );
  return path;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

/** Line and column (1-based) of a character offset in text. */
function position(text: string, offset: number) {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - before.lastIndexOf("\n") };
}

/**
 * Offset of the first JSON syntax error. V8 reports a position for some
 * errors only ("Unexpected token" has none), so the text is scanned again.
 */
export function jsonErrorOffset(text: string): number | undefined {
  let index = 0;
  const space = () => {
    while (/[ \t\n\r]/.test(text[index] ?? "")) index++;
  };
  const fail = (): never => {
    throw index;
  };
  const literal = (word: string) => {
    for (const char of word) if (text[index++] !== char) fail();
  };
  const string = () => {
    if (text[index] !== '"') fail();
    index++;
    for (;;) {
      const char = text[index];
      if (char === undefined || char < " ") fail();
      if (char === '"') return void index++;
      if (char === "\\") {
        index++;
        const escape = text[index];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(index + 1, index + 5)))
            fail();
          index += 5;
        } else if ('"\\/bfnrt'.includes(escape ?? "x")) index++;
        else fail();
      } else index++;
    }
  };
  const number = () => {
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(
      text.slice(index),
    );
    if (!match) fail();
    index += match![0].length;
  };
  const value = (): void => {
    space();
    const char = text[index];
    if (char === "{") {
      index++;
      space();
      if (text[index] === "}") return void index++;
      for (;;) {
        space();
        string();
        space();
        if (text[index] !== ":") fail();
        index++;
        value();
        space();
        if (text[index] === ",") {
          index++;
          continue;
        }
        if (text[index] === "}") return void index++;
        fail();
      }
    }
    if (char === "[") {
      index++;
      space();
      if (text[index] === "]") return void index++;
      for (;;) {
        value();
        space();
        if (text[index] === ",") {
          index++;
          continue;
        }
        if (text[index] === "]") return void index++;
        fail();
      }
    }
    if (char === '"') return string();
    if (char === "t") return literal("true");
    if (char === "f") return literal("false");
    if (char === "n") return literal("null");
    return number();
  };
  try {
    value();
    space();
    return index < text.length ? index : undefined;
  } catch (offset) {
    if (typeof offset === "number") return offset;
    throw offset;
  }
}

/** Parses JSON text and names the file, line and column of a syntax error. */
export function parseJsonText(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const at = /position (\d+)/.exec(message);
    const offset = at ? Number(at[1]) : jsonErrorOffset(text);
    const where = offset === undefined ? undefined : position(text, offset);
    const failure = new CoreError(
      "INVALID_DATA",
      `${label} is not valid JSON${where ? ` at line ${where.line}, column ${where.column}` : ""}: ${message.replace(/^.*?:\s*/, "")}`,
    );
    failure.details = { file: label, ...(where ?? {}) };
    throw failure;
  }
}

/** Reads one UTF-8 JSON file named by an absolute path, within a byte budget. */
export async function readJsonInput(
  path: unknown,
  field: string,
  limitBytes: number,
): Promise<unknown> {
  const absolute = assertLocalPath(path, field);
  const info = await stat(absolute).catch((error: NodeJS.ErrnoException) => {
    throw new CoreError(
      error.code === "ENOENT" ? "NOT_FOUND" : "INVALID_PATH",
      `${field} ${absolute} cannot be read (${error.code ?? error.message}).`,
    );
  });
  if (!info.isFile())
    throw new CoreError(
      "INVALID_PATH",
      `${field} ${absolute} is not a regular file.`,
    );
  if (info.size > limitBytes)
    throw new CapacityError(`${field} ${absolute}`, info.size, limitBytes);
  const bytes = await readFile(absolute);
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new CoreError(
      "INVALID_DATA",
      `${field} ${absolute} is not UTF-8 text.`,
    );
  }
  return parseJsonText(text.replace(/^﻿/, ""), `${field} ${absolute}`);
}

/**
 * Takes a value either inline or from a file argument, never both. The file
 * holds exactly the JSON value the inline argument would carry.
 */
export async function inlineOrFile<T>(input: {
  inline: T | undefined;
  inlineName: string;
  file: unknown;
  fileName: string;
  limitBytes: number;
  required?: boolean;
  localFiles: boolean;
}): Promise<T | undefined> {
  if (input.file !== undefined && !input.localFiles)
    throw new CoreError(
      "INVALID_DATA",
      `${input.fileName} reads a file on the device running ShowAI and is only available on local connections. Pass ${input.inlineName} inline.`,
    );
  if (input.file !== undefined && input.inline !== undefined)
    throw new CoreError(
      "INVALID_DATA",
      `Pass ${input.inlineName} or ${input.fileName}, not both.`,
    );
  if (input.file === undefined) {
    if (input.required && input.inline === undefined)
      throw new CoreError(
        "INVALID_DATA",
        `Pass ${input.inlineName}${input.localFiles ? `, or ${input.fileName} with an absolute path to a JSON file` : ""}.`,
      );
    return input.inline;
  }
  return (await readJsonInput(
    input.file,
    input.fileName,
    input.limitBytes,
  )) as T;
}

/** Receipt fields that identify written output without returning it. */
export async function fileReceipt(path: string) {
  const bytes = await readFile(path);
  return {
    path,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
