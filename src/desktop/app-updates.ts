import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, autoUpdater as nativeUpdater } from "electron";
import {
  autoUpdater,
  type ProgressInfo,
  type UpdateInfo,
} from "electron-updater";
import {
  APP_UPDATE_RESTART_DELAY_MS,
  type AppUpdateInstallMode,
  type AppUpdateState,
} from "../host/protocol";
import type { LogLevel } from "./main-log";

const FIRST_CHECK_DELAY_MS = 20_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INSTALL_FALLBACK_MS = 20_000;
const EXIT_FALLBACK_MS = 10_000;

export const appUpdateActions = new Set([
  "appUpdate:state",
  "appUpdate:check",
  "appUpdate:download",
  "appUpdate:setAutomatic",
  "appUpdate:install",
  "appUpdate:defer",
]);

function shortError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const line = text.split("\n", 1)[0]!.trim();
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
}

export class AppUpdates {
  private state: AppUpdateState;
  private timer?: ReturnType<typeof setInterval>;
  private firstCheck?: ReturnType<typeof setTimeout>;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private checking?: Promise<void>;

  constructor(
    private readonly options: {
      automatic: boolean;
      log: (level: LogLevel, ...values: unknown[]) => void;
      publish: (state: AppUpdateState) => void;
      saveAutomatic: (automatic: boolean) => Promise<void>;
      quit: () => void;
    },
  ) {
    const unavailableReason = !app.isPackaged
      ? "development"
      : existsSync(join(process.resourcesPath, "app-update.yml"))
        ? undefined
        : "missingFeed";
    this.state = {
      supported: !unavailableReason,
      unavailableReason,
      automatic: options.automatic,
      currentVersion: app.getVersion(),
      phase: "idle",
    };
    if (unavailableReason) return;
    const log = options.log;
    autoUpdater.logger = {
      info: (message?: unknown) => log("info", message),
      warn: (message?: unknown) => log("warn", message),
      error: (message?: unknown) => log("error", message),
      debug: () => {},
    };
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () =>
      this.set({
        phase: "checking",
        installMode: undefined,
        retryDownload: false,
        error: undefined,
      }),
    );
    autoUpdater.on("update-not-available", () =>
      this.set({
        phase: "current",
        version: undefined,
        checkedAt: new Date().toISOString(),
      }),
    );
    autoUpdater.on("update-available", (info: UpdateInfo) =>
      this.set({
        phase: "available",
        version: info.version,
        percent: 0,
        checkedAt: new Date().toISOString(),
      }),
    );
    autoUpdater.on("download-progress", (progress: ProgressInfo) => {
      if (this.state.phase === "downloading")
        this.set({ percent: Math.floor(progress.percent) });
    });
    autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
      if (this.state.phase !== "downloading") return;
      if (process.platform === "darwin")
        this.set({ version: info.version, percent: 100 });
      else this.ready(info.version);
    });
    if (process.platform === "darwin")
      nativeUpdater.on("update-downloaded", () =>
        this.ready(this.state.version),
      );
    autoUpdater.on("error", (error: Error) => this.failed(error));
  }

  private ready(version?: string): void {
    if (this.state.phase !== "downloading") return;
    let restartAt: number | undefined;
    if (this.state.installMode === "restart") {
      restartAt = Date.now() + APP_UPDATE_RESTART_DELAY_MS;
      this.restartTimer = setTimeout(
        () => this.requestInstall(),
        APP_UPDATE_RESTART_DELAY_MS,
      );
      this.restartTimer.unref();
    }
    this.set({
      phase: "ready",
      version,
      percent: 100,
      restartAt,
      error: undefined,
      retryDownload: false,
    });
  }

  private failed(error: unknown): void {
    if (this.state.phase === "ready" || this.state.phase === "installing")
      return;
    this.set({
      phase: "failed",
      retryDownload:
        this.state.phase === "downloading" || this.state.retryDownload,
      error: shortError(error),
    });
  }

  status(): AppUpdateState {
    return this.state;
  }

  start(): void {
    if (!this.state.supported) return;
    const scheduledCheck = () => {
      if (
        this.state.automatic &&
        this.state.phase !== "available" &&
        !this.state.retryDownload
      )
        void this.check();
    };
    this.firstCheck = setTimeout(scheduledCheck, FIRST_CHECK_DELAY_MS);
    this.firstCheck.unref();
    this.timer = setInterval(scheduledCheck, CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  async check(): Promise<AppUpdateState> {
    if (
      !this.state.supported ||
      this.state.phase === "ready" ||
      this.state.phase === "installing"
    )
      return this.state;
    if (this.state.phase === "downloading") return this.state;
    this.checking ??= autoUpdater
      .checkForUpdates()
      .then(
        () => {},
        (error: unknown) => this.failed(error),
      )
      .finally(() => {
        this.checking = undefined;
      });
    await this.checking;
    return this.state;
  }

  async download(mode?: AppUpdateInstallMode): Promise<AppUpdateState> {
    if (
      this.state.phase !== "available" &&
      !(this.state.phase === "failed" && this.state.retryDownload)
    )
      return this.state;
    const installMode = mode ?? this.state.installMode ?? "onQuit";
    this.set({
      phase: "downloading",
      installMode,
      percent: 0,
      error: undefined,
      retryDownload: false,
    });
    await autoUpdater
      .downloadUpdate()
      .catch((error: unknown) => this.failed(error));
    return this.state;
  }

  async setAutomatic(automatic: boolean): Promise<AppUpdateState> {
    await this.options.saveAutomatic(automatic);
    this.set({ automatic });
    if (automatic && this.state.phase !== "available") await this.check();
    return this.state;
  }

  private requestInstall(): void {
    if (this.state.phase !== "ready") return;
    clearTimeout(this.restartTimer);
    this.set({ phase: "installing", restartAt: undefined });
    this.options.quit();
  }

  deferRestart(): void {
    if (
      this.state.installMode !== "restart" ||
      this.state.phase === "installing"
    )
      return;
    clearTimeout(this.restartTimer);
    this.set({ installMode: "onQuit", restartAt: undefined });
  }

  cancelInstall(): void {
    if (this.state.phase === "installing")
      this.set({ phase: "ready", installMode: "onQuit", restartAt: undefined });
  }

  finishQuit(quit: () => void): boolean {
    if (this.state.phase !== "installing") return false;
    const log = this.options.log;
    log("info", `Installing ShowAI ${this.state.version} and relaunching.`);
    const exit = () => {
      quit();
      setTimeout(() => {
        log(
          "warn",
          "ShowAI did not quit after the update was installed; exiting.",
        );
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
  ): Promise<AppUpdateState> {
    switch (action) {
      case "appUpdate:state":
        return this.state;
      case "appUpdate:check":
        return this.check();
      case "appUpdate:download":
        if (args.version !== undefined && args.version !== this.state.version)
          return this.state;
        if (
          args.mode !== undefined &&
          args.mode !== "restart" &&
          args.mode !== "onQuit"
        )
          throw new TypeError("Unknown update installation mode.");
        return this.download(args.mode);
      case "appUpdate:setAutomatic":
        if (typeof args.automatic !== "boolean")
          throw new TypeError(
            "appUpdate:setAutomatic needs a boolean `automatic`.",
          );
        return this.setAutomatic(args.automatic);
      case "appUpdate:install":
        if (
          args.version === undefined ||
          (args.version === this.state.version &&
            this.state.restartAt !== undefined)
        )
          this.requestInstall();
        return this.state;
      case "appUpdate:defer":
        if (
          args.version === this.state.version &&
          this.state.restartAt !== undefined
        )
          this.deferRestart();
        return this.state;
      default:
        throw new TypeError(`Unknown update action: ${action}`);
    }
  }

  dispose(): void {
    clearTimeout(this.firstCheck);
    clearTimeout(this.restartTimer);
    clearInterval(this.timer);
  }

  private set(change: Partial<AppUpdateState>): void {
    this.state = { ...this.state, ...change };
    if (change.phase && change.phase !== "downloading")
      this.options.log(
        "info",
        `Update ${change.phase}${this.state.version ? ` ${this.state.version}` : ""}${change.error ? `: ${change.error}` : ""}`,
      );
    this.options.publish(this.state);
  }
}
