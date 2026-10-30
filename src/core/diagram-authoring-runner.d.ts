export interface DiagramAuthoringOptions {
  kit: string;
  type: string;
  input: string;
  out: string;
  workDir: string;
  overwrite?: boolean;
  embedFonts?: boolean;
  fontLicenses?: string;
  python?: string;
  cwd?: string;
}
export function defaultPython(): string;
export function generateDiagram(options: DiagramAuthoringOptions): Promise<{
  format: "showai-diagram-result";
  version: 1;
  family: string;
  repository: string;
  commit: string;
  type: string;
  path: string;
  sourceSha256: string;
  originalSourceSha256: string;
  fonts: { url: string; sha256: string; bytes: number }[];
  data: {
    template: "custom";
    source: string;
    height: number;
    presentation: {
      title: "outside";
      description: "outside";
      notes: "hidden";
      legend: true;
      controls: true;
    };
  };
  input?: unknown;
  execution: { stdout: string; stderr: string };
}>;
