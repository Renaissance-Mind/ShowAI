export const DSH_BUNDLE_FILES: readonly string[];
export const DSH_LOGOS: readonly string[];
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
  skillNames?: string[];
}): Promise<DshProfileState>;
