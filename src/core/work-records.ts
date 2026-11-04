import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { atomicRename } from "./atomic-rename";

/**
 * Where Agents keep the stage records of a work (reader brief, material notes,
 * presentation plan, review). Records are working material on this device:
 * they are not content, are not synchronized and never ship with a page.
 */
export interface WorkRecordsSetting {
  format: "showai-work-records";
  version: 1;
  directory: string;
  recordedAt: string;
}

export interface WorkRecordsLocation {
  directory: string;
  /** environment: SHOWAI_RECORDS_DIR; setting: Settings → General; default: the system temporary directory. */
  source: "environment" | "setting" | "default";
}

export const workRecordsSettingPath = (root: string) =>
  join(root, "local", "work-records.json");

export const defaultWorkRecordsDirectory = () =>
  join(tmpdir(), "showai-records");

function absoluteDirectory(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || !isAbsolute(value))
    throw new Error(`${label} must be an absolute directory path.`);
  return resolve(value);
}

export async function readWorkRecordsSetting(
  root: string,
): Promise<string | undefined> {
  const path = workRecordsSettingPath(root);
  const text = await readFile(path, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (text === null) return undefined;
  const value = JSON.parse(text) as WorkRecordsSetting;
  if (value.format !== "showai-work-records" || value.version !== 1)
    throw new Error(`Invalid work records setting: ${path}`);
  return absoluteDirectory(value.directory, "The work records directory");
}

/** null returns to the default location. */
export async function setWorkRecordsDirectory(
  root: string,
  directory: string | null,
): Promise<WorkRecordsLocation> {
  const path = workRecordsSettingPath(root);
  if (directory === null) await rm(path, { force: true });
  else {
    const value: WorkRecordsSetting = {
      format: "showai-work-records",
      version: 1,
      directory: absoluteDirectory(directory, "The work records directory"),
      recordedAt: new Date().toISOString(),
    };
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n");
    await atomicRename(temporary, path);
  }
  return workRecordsLocation(root);
}

/** SHOWAI_RECORDS_DIR isolates development and test instances. */
export async function workRecordsLocation(
  root: string,
): Promise<WorkRecordsLocation> {
  if (process.env.SHOWAI_RECORDS_DIR)
    return {
      directory: absoluteDirectory(
        process.env.SHOWAI_RECORDS_DIR,
        "SHOWAI_RECORDS_DIR",
      ),
      source: "environment",
    };
  const configured = await readWorkRecordsSetting(root);
  return configured
    ? { directory: configured, source: "setting" }
    : { directory: defaultWorkRecordsDirectory(), source: "default" };
}
