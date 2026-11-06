import { app, type BrowserWindow } from "electron";

/** Window presentation belongs to this process; it is never saved in user settings. */
export class DesktopPresentation {
  constructor(
    public background: boolean,
    private readonly windows: Set<BrowserWindow>,
    private readonly publish: (
      state: ReturnType<DesktopPresentation["state"]>,
    ) => void,
  ) {
    if (background && process.platform === "darwin")
      app.setActivationPolicy("accessory");
  }

  state() {
    return {
      background: this.background,
      windows: [...this.windows]
        .filter((window) => !window.isDestroyed())
        .map((window) => ({
          id: window.id,
          visible: window.isVisible(),
          focused: window.isFocused(),
        })),
    };
  }

  report = () => this.publish(this.state());

  track(window: BrowserWindow) {
    window.on("show", this.report);
    window.on("hide", this.report);
    window.on("focus", this.report);
    window.on("blur", this.report);
    window.on("closed", this.report);
    this.report();
  }

  show(window: BrowserWindow, explicit = false) {
    if (window.isDestroyed() || (this.background && !explicit)) return;
    if (explicit) {
      this.background = false;
      if (process.platform === "darwin") app.setActivationPolicy("regular");
    }
    if (window.isMinimized()) window.restore();
    window.show();
    if (explicit) window.focus();
    this.report();
  }

  hide() {
    this.background = true;
    for (const window of this.windows) {
      if (window.isDestroyed()) continue;
      window.webContents.setBackgroundThrottling(false);
      window.hide();
    }
    if (process.platform === "darwin") app.setActivationPolicy("accessory");
    this.report();
  }
}
