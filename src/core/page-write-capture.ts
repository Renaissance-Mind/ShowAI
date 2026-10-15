import { AsyncLocalStorage } from "node:async_hooks";
import type { ShowDocument } from "../types";

export interface PageWrite {
  projectId: string;
  pageId: string;
  before: ShowDocument;
  beforeHash: string;
  after: ShowDocument;
  afterHash: string;
}

/** Captures exact page baselines inside the writer's transaction, never watcher snapshots. */
export const pageWriteCapture = new AsyncLocalStorage<PageWrite[]>();
