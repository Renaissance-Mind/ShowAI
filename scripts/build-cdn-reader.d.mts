export declare function buildCdnReader(outdir?: string): Promise<{
  manifest: {
    format: "showai-cdn-reader";
    version: string;
    entry: string;
    integrity: string;
    files: number;
    bytes: number;
  };
  metafile: import("esbuild").Metafile;
}>;
