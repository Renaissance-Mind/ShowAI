import type { DesktopChange, DesktopResponse } from "./protocol";

export const workbenchChunkBytes = 192 * 1024;
export const workbenchRoutes = ["invoke", "locale", "dialog/list", "dialog/mkdir"] as const;
export type WorkbenchRoute = typeof workbenchRoutes[number];

export interface WorkbenchAsset {
  sha256: string;
  bytes: number;
  imports: string[];
}

export interface WorkbenchBundle {
  entry: string;
  style: string;
  assets: Record<string, WorkbenchAsset>;
}

export interface WorkbenchMediaChunk {
  base64: string;
  size: number;
  mime: string;
}

export interface WorkbenchChanges {
  cursor: number;
  changes: DesktopChange[];
}

export interface CodexWorkbenchTransport {
  bundle(): Promise<WorkbenchBundle>;
  asset(name: string, offset: number): Promise<string>;
  request(route: WorkbenchRoute, args: Record<string, unknown>, client: string): Promise<DesktopResponse<unknown>>;
  changes(after: number, client: string): WorkbenchChanges;
  media(token: string, offset: number): Promise<WorkbenchMediaChunk>;
}
