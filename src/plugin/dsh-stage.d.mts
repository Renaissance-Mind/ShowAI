export declare const DSH_BUNDLE: string;
export declare const DSH_LEGACY_BUNDLES: string[];
export declare function dshHome(): string;
export declare function dshFingerprint(
  root: string,
): Promise<{ verifiedFiles: number; treeSha256: string }>;
export interface DshStageReceipt {
  path: string;
  version: string;
  home: string;
  /** The stdio MCP server written into the bundle's showai-mcp row. */
  server: {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
  };
  verifiedFiles: number;
  treeSha256: string;
}
export declare function stageDshBundle(options: {
  target: string;
  bundleRoot: string;
  pluginRoot: string;
  runtime: { command: string; env: Record<string, string> };
  home: string;
}): Promise<DshStageReceipt>;
export interface DshProfileState {
  home: string;
  profile: string;
  profileFound: boolean;
  installed: boolean;
  enabled: boolean;
  otherSource?: string;
  legacyBundles: string[];
  manualMcpRow: boolean;
  shadowingSkills: string[];
}
export declare function inspectDshProfile(options: {
  target?: string;
  home?: string;
  /** Skill names the bundle ships; same-name user skills shadow them. */
  skillNames?: string[];
}): Promise<DshProfileState>;
