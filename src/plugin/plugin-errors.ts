/** Codes the plugin page translates; `details` keeps the host CLI's own output for the collapsed view. */
export type PluginErrorCode =
  | "PLUGIN_UNKNOWN_HOST"
  | "PLUGIN_BUSY"
  | "PLUGIN_HOST_MISSING"
  | "PLUGIN_HOST_TOO_OLD"
  | "PLUGIN_HOST_COMMAND_FAILED"
  | "PLUGIN_OTHER_SOURCE"
  | "PLUGIN_MARKETPLACE_CONFLICT"
  | "PLUGIN_BUNDLE_INVALID"
  | "PLUGIN_BUNDLE_CHANGED"
  | "PLUGIN_NOT_CONFIRMED"
  | "PLUGIN_FILES_MISMATCH"
  | "PLUGIN_PATH_INVALID";

/** Host versions the App's plugin commands were verified with (`plugin list --json`). */
export const VERIFIED_HOST_VERSIONS = {
  codex: "0.163.0",
  claude: "2.1.306",
} as const;

export class PluginInstallError extends Error {
  constructor(
    readonly code: PluginErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
