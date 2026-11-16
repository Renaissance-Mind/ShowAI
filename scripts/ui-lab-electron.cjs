const { app, BrowserWindow } = require("electron");
app.setPath("userData", process.env.SHOWAI_UI_LAB_PROFILE);
app.commandLine.appendSwitch(
  "force-device-scale-factor",
  process.env.SHOWAI_UI_LAB_SCALE || "2",
);
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
if (process.platform === "darwin") app.setActivationPolicy("accessory");
global.__SHOWAI_UI_LAB_FOCUS__ = [];
app.on("browser-window-created", (_event, window) => {
  for (const event of ["show", "focus"])
    window.on(event, () =>
      global.__SHOWAI_UI_LAB_FOCUS__.push({ event, at: Date.now() }),
    );
});
app.on("activate", () =>
  global.__SHOWAI_UI_LAB_FOCUS__.push({ event: "activate", at: Date.now() }),
);
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: Number(process.env.SHOWAI_UI_LAB_WIDTH),
    height: Number(process.env.SHOWAI_UI_LAB_HEIGHT),
    useContentSize: true,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await window.loadURL(process.env.SHOWAI_UI_LAB_URL);
});
app.on("window-all-closed", () => app.quit());
