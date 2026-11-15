export const INSTANCE_FORMAT: "showai-instance";

export interface InstanceDetails {
  mode: "desktop" | "browser";
  channel: "packaged" | "development";
  appVersion: string;
  sourceCommit?: string;
  cli?: { command: string; args: string[] };
  url?: string;
  developmentUrl?: string;
  logs?: string;
  userData?: string;
}

export interface InstanceRecord extends Required<
  Pick<InstanceDetails, "mode" | "channel" | "appVersion">
> {
  format: "showai-instance";
  version: 1;
  pid: number;
  ppid: number;
  sourceCommit: string;
  executable: string;
  entry: string | null;
  cli: { command: string; args: string[] } | null;
  url?: string;
  developmentUrl?: string;
  logs?: string;
  userData?: string;
  home: string;
  startedAt: string;
  publishedAt: string;
}

export interface InstanceHandle {
  path: string;
  record: InstanceRecord;
  remove(): Promise<void>;
}

export function instanceDirectory(home: string): string;
export function processAlive(pid: number): boolean;
export function publishInstance(
  home: string,
  details: InstanceDetails,
): Promise<InstanceHandle>;
export function readInstances(
  home: string,
  commands?: Map<number, string>,
): Promise<{
  instances: (InstanceRecord & { path: string })[];
  ignored: {
    path: string;
    pid?: number;
    reason: "INVALID" | "NOT_RUNNING" | "COMMAND_MISMATCH";
  }[];
}>;
