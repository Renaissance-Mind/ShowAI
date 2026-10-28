import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, autoUpdater as nativeUpdater } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import type { AppUpdateState } from "./bridge";
import type { LogLevel } from "./main-log";

const FIRST_CHECK_DELAY_MS = 20_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Squirrel normally terminates ShowAI within a second. If it does not, a
// normal quit still installs the update and relaunches, as Squirrel is armed.
const INSTALL_FALLBACK_MS = 20_000;
const EXIT_FALLBACK_MS = 10_000;

/** Renderer actions handled by AppUpdates.action. */
export const appUpdateActions = new Set([
  "appUpdate:state",
  "appUpdate:check",
  "appUpdate:download",
  "appUpdate:setAutomatic",
  "appUpdate:install",
]);

/** First line of an updater error; GitHub failures append whole response bodies. */
function shortError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const line = text.split("\n", 1)[0]!.trim();
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
}

/**
 * Release builds check the GitHub release feed named in Resources/app-update.yml,
 * download a newer version in the background and install it when ShowAI quits
 * or when the person restarts from the notice. Development and source builds
 * (the local stable App is packaged without a feed) report `supported: false`.
 */
export class AppUpdates {
  private state: AppUpdateState;
  private timer?: ReturnType<typeof setInterval>;
  private checking?: Promise<void>;
  private installRequested = false;

  constructor(
    private readonly options: {
      automatic: boolean;
      log: (level: LogLevel, ...values: unknown[]) => void;
      publish: (state: AppUpdateState) => void;
      saveAutomatic: (automatic: boolean) => Promise<void>;
    },
  ) {
    const supported =
      app.isPackaged &&
      existsSync(join(process.resourcesPath, "app-update.yml"));
    this.state = {
      supported,
      automatic: options.automatic,
      currentVersion: app.getVersion(),
      phase: "idle",
    };
    if (!supported) return;
    const log = options.log;
    autoUpdater.logger = {
      info: (message?: unknown) => log("info", message),
      warn: (message?: unknown) => log("warn", message),
      error: (message?: unknown) => log("error", message),
      debug: () => {},
    };
    autoUpdater.autoDownload = options.automatic;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () => this.set({ phase: "checking" }));
    autoUpdater.on("update-not-available", () =>
      this.set({
        phase: "current",
        version: undefined,
        checkedAt: new Date().toISOString(),
      }),
    );
    autoUpdater.on("update-available", (info: UpdateInfo) =>
      this.set({
        phase: autoUpdater.autoDownload ? "downloading" : "available",
        version: info.version,
        percent: 0,
        checkedAt: new Date().toISOString(),
      }),
    );
    autoUpdater.on("download-progress", (progress: ProgressInfo) =>
      this.set({ phase: "downloading", percent: Math.floor(progress.percent) }),
    );
    // On macOS, Squirrel copies the download from electron-updater before it
    // can install; restarting earlier quits without installing.
    autoUpdater.on("update-downloaded", (info: UpdateInfo) =>
      this.set(
        process.platform === "darwin"
          ? { phase: "downloading", version: info.version, percent: 100 }
          : { phase: "ready", version: info.version, error: undefined },
      ),
    );
    if (process.platform === "darwin")
      nativeUpdater.on("update-downloaded", () =>
        this.set({ phase: "ready", error: undefined }),
      );
    autoUpdater.on("error", (error: Error) => {
      // A downloaded update stays installable even when a later check fails.
      if (this.state.phase === "ready") return;
      this.set({ phase: "failed", error: shortError(error) });
    });
  }

  status(): AppUpdateState {
    return this.state;
  }

  /** Starts the background schedule; checks run only while automatic updates are on. */
  start(): void {
    if (!this.state.supported) return;
    setTimeout(() => {
      if (this.state.automatic) void this.check();
    }, FIRST_CHECK_DELAY_MS).unref();
    this.timer = setInterval(() => {
      if (this.state.automatic) void this.check();
    }, CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  async check(): Promise<AppUpdateState> {
    if (!this.state.supported || this.state.phase === "ready") return this.state;
    if (this.state.phase === "downloading") return this.state;
    this.checking ??= autoUpdater
      .checkForUpdates()
      .then(
        () => {},
        (error: unknown) =>
          this.set({ phase: "failed", error: shortError(error) }),
      )
      .finally(() => {
        this.checking = undefined;
      });
    await this.checking;
    return this.state;
  }

  async download(): Promise<AppUpdateState> {
    if (this.state.phase !== "available") return this.state;
    this.set({ phase: "downloading", percent: 0 });
    await autoUpdater.downloadUpdate().catch((error: unknown) => {
      this.set({ phase: "failed", error: shortError(error) });
    });
    return this.state;
  }

  async setAutomatic(automatic: boolean): Promise<AppUpdateState> {
    await this.options.saveAutomatic(automatic);
    if (this.state.supported) autoUpdater.autoDownload = automatic;
    this.set({ automatic });
    if (automatic && this.state.phase === "available") await this.download();
    else if (automatic && this.state.phase !== "ready") await this.check();
    return this.state;
  }

  /** The restart button asks ShowAI to quit; windows still save before it does. */
  requestInstall(quit: () => void): void {
    if (this.state.phase !== "ready") return;
    this.installRequested = true;
    quit();
  }

  /** A window kept ShowAI open; the next ordinary quit installs without relaunching. */
  cancelInstall(): void {
    this.installRequested = false;
  }

  /**
   * Called once every window has closed and services have stopped. Returns
   * true when the updater takes over quitting and relaunches the new version.
   */
  finishQuit(quit: () => void): boolean {
    if (!this.installRequested || this.state.phase !== "ready") return false;
    const log = this.options.log;
    log("info", `Installing ShowAI ${this.state.version} and relaunching.`);
    // Windows are closed and services stopped, so exiting cannot lose work.
    const exit = () => {
      quit();
      setTimeout(() => {
        log("warn", "ShowAI did not quit after the update was installed; exiting.");
        app.exit(0);
      }, EXIT_FALLBACK_MS);
    };
    const fallback = setTimeout(() => {
      log("warn", "The updater did not quit ShowAI; quitting normally.");
      exit();
    }, INSTALL_FALLBACK_MS);
    nativeUpdater.once("before-quit-for-update", () =>
      log("info", "Squirrel is quitting ShowAI to install the update."),
    );
    autoUpdater.once("error", (error: Error) => {
      log("error", `Installing the update failed: ${shortError(error)}`);
      clearTimeout(fallback);
      exit();
    });
    autoUpdater.quitAndInstall(true, true);
    return true;
  }

  async action(
    action: string,
    args: Record<string, unknown>,
    quit: () => void,
  ): Promise<AppUpdateState> {
    switch (action) {
      case "appUpdate:state":
        return this.state;
      case "appUpdate:check":
        return this.check();
      case "appUpdate:download":
        return this.download();
      case "appUpdate:setAutomatic":
        if (typeof args.automatic !== "boolean")
          throw new TypeError("appUpdate:setAutomatic needs a boolean `automatic`.");
        return this.setAutomatic(args.automatic);
      case "appUpdate:install":
        this.requestInstall(quit);
        return this.state;
      default:
        throw new TypeError(`Unknown update action: ${action}`);
    }
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  private set(change: Partial<AppUpdateState>): void {
    this.state = { ...this.state, ...change };
    if (change.phase && change.phase !== "downloading")
      this.options.log("info", `Update ${change.phase}${this.state.version ? ` ${this.state.version}` : ""}${change.error ? `: ${change.error}` : ""}`);
    this.options.publish(this.state);
  }
}
