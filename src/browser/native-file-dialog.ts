import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface NativeDialogRequest {
  mode: "directory" | "openFile" | "saveFile";
  title?: string;
  defaultPath?: string;
  defaultName?: string;
  extensions?: string[];
  disabled?: boolean;
}

export interface NativeDialogResult {
  supported: boolean;
  path: string | null;
}

const CANCEL_SENTINEL = "__SHOWAI_NATIVE_DIALOG_CANCELLED__";

function cleanResultPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === CANCEL_SENTINEL) return null;
  if (trimmed.length > 1 && trimmed.endsWith("/")) return trimmed.slice(0, -1);
  return trimmed;
}

async function runMacDialog(
  options: NativeDialogRequest,
): Promise<NativeDialogResult> {
  const exts = (options.extensions ?? [])
    .map((ext) => ext.trim().replace(/^\./, ""))
    .filter((ext) => /^[a-z0-9]+$/i.test(ext));
  const chooseCmd =
    options.mode === "directory"
      ? "choose folder with prompt dlgPrompt"
      : options.mode === "saveFile"
        ? "choose file name with prompt dlgPrompt"
        : exts.length
          ? `choose file with prompt dlgPrompt of type {${exts.map((e) => `"${e}"`).join(", ")}}`
          : "choose file with prompt dlgPrompt";

  const withDefaults = [
    chooseCmd,
    options.defaultPath ? "default location (POSIX file dlgPath)" : "",
    options.mode === "saveFile" && options.defaultName
      ? "default name dlgName"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const withoutLocation = [
    chooseCmd,
    options.mode === "saveFile" && options.defaultName
      ? "default name dlgName"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const script = `
set dlgPrompt to system attribute "SHOWAI_DLG_PROMPT"
set dlgPath to system attribute "SHOWAI_DLG_PATH"
set dlgName to system attribute "SHOWAI_DLG_NAME"
try
  if dlgPath is not "" then
    set picked to ${withDefaults}
  else
    set picked to ${withoutLocation}
  end if
  return POSIX path of picked
on error errMsg number errNum
  if errNum is -128 then
    return "${CANCEL_SENTINEL}"
  end if
  try
    set picked to ${withoutLocation}
    return POSIX path of picked
  on error retryMsg number retryNum
    if retryNum is -128 then
      return "${CANCEL_SENTINEL}"
    end if
    error retryMsg number retryNum
  end try
end try
`.trim();

  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", script], {
      env: {
        ...process.env,
        SHOWAI_DLG_PROMPT: options.title ?? "",
        SHOWAI_DLG_PATH: options.defaultPath ?? "",
        SHOWAI_DLG_NAME: options.defaultName ?? "",
      },
      timeout: 180000,
    });
    return { supported: true, path: cleanResultPath(stdout) };
  } catch (error) {
    const err = error as { stderr?: string; message?: string; code?: number };
    const text = `${err.stderr ?? ""} ${err.message ?? ""}`;
    if (text.includes("-128") || /user canceled/i.test(text)) {
      return { supported: true, path: null };
    }
    return { supported: false, path: null };
  }
}

async function runWindowsDialog(
  options: NativeDialogRequest,
): Promise<NativeDialogResult> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
[System.Windows.Forms.Application]::EnableVisualStyles()
$mode = $env:SHOWAI_DLG_MODE
$title = $env:SHOWAI_DLG_PROMPT
$initPath = $env:SHOWAI_DLG_PATH
$initName = $env:SHOWAI_DLG_NAME
$extSpec = $env:SHOWAI_DLG_EXT
if ($mode -eq "directory") {
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  if ($title) { $dlg.Description = $title }
  if ($initPath -and (Test-Path -LiteralPath $initPath)) { $dlg.SelectedPath = $initPath }
  if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dlg.SelectedPath }
} elseif ($mode -eq "saveFile") {
  $dlg = New-Object System.Windows.Forms.SaveFileDialog
  if ($title) { $dlg.Title = $title }
  if ($initPath -and (Test-Path -LiteralPath $initPath)) { $dlg.InitialDirectory = $initPath }
  if ($initName) { $dlg.FileName = $initName }
  if ($extSpec) { $dlg.Filter = $extSpec }
  if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dlg.FileName }
} else {
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  if ($title) { $dlg.Title = $title }
  if ($initPath -and (Test-Path -LiteralPath $initPath)) { $dlg.InitialDirectory = $initPath }
  if ($extSpec) { $dlg.Filter = $extSpec }
  if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dlg.FileName }
}
`.trim();

  const exts = (options.extensions ?? [])
    .map((ext) => ext.trim().replace(/^\./, ""))
    .filter((ext) => /^[a-z0-9]+$/i.test(ext));
  const extFilter = exts.length
    ? `Supported (${exts.map((e) => `*.${e}`).join("; ")})|${exts.map((e) => `*.${e}`).join(";")}|All files (*.*)|*.*`
    : "All files (*.*)|*.*";

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-Command", script],
      {
        env: {
          ...process.env,
          SHOWAI_DLG_MODE: options.mode,
          SHOWAI_DLG_PROMPT: options.title ?? "",
          SHOWAI_DLG_PATH: options.defaultPath ?? "",
          SHOWAI_DLG_NAME: options.defaultName ?? "",
          SHOWAI_DLG_EXT: extFilter,
        },
        timeout: 180000,
      },
    );
    const picked = stdout.trim();
    return { supported: true, path: picked || null };
  } catch {
    return { supported: false, path: null };
  }
}

export async function openNativeOsDialog(
  options: NativeDialogRequest,
): Promise<NativeDialogResult> {
  if (options.disabled || process.env.VITEST || process.env.CI) {
    return { supported: false, path: null };
  }
  if (process.platform === "darwin") return runMacDialog(options);
  if (process.platform === "win32") return runWindowsDialog(options);
  return { supported: false, path: null };
}
