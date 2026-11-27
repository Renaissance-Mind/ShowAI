import { readInstances } from "../core/instance-presence.mjs";
import { pageLink } from "../document/page-link.mjs";
import { openSystemUrl } from "../host/local-system";
import { sendToRunningDesktop } from "../host/desktop-page-channel";
import type { CodexPageTarget } from "./codex-page-reference";

export async function openDesktopPage(home: string, target: CodexPageTarget): Promise<string> {
  const url = pageLink({ ...target, blockIds: target.blockId ? [target.blockId] : [] });
  const { instances } = await readInstances(home);
  const desktops = instances.filter(instance => instance.mode === "desktop" && instance.home === home);
  desktops.sort((a, b) => Number(b.channel === "packaged") - Number(a.channel === "packaged"));
  for (const desktop of desktops) {
    if (desktop.desktopPageChannel && await sendToRunningDesktop(desktop.desktopPageChannel, home, url))
      return url;
  }
  const instance = desktops.length === 1 ? desktops[0] : undefined;
  if (instance?.channel !== "development" || !instance.developmentUrl) {
    await openSystemUrl(url);
    return url;
  }

  // A development library has its own Electron instance. The OS scheme may belong to the stable app.
  const origin = new URL(instance.developmentUrl);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || !origin.port ||
      origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash)
    throw new Error("Invalid desktop development instance address.");
  const options = { redirect: "error" as const, signal: AbortSignal.timeout(3000) };
  const response = await fetch(new URL("/__showai-dev/status", origin), options);
  if (!response.ok) throw new Error("The desktop development instance is unavailable.");
  const state = await response.json();
  if (state.protocol !== "showai-development-v1" || state.mode !== "desktop" ||
      !state.ready || state.home !== home || state.backendPid !== instance.pid)
    throw new Error("The desktop development instance no longer owns this library.");
  const focus = new URL("/__showai-dev/focus", origin);
  focus.searchParams.set("url", url);
  const opened = await fetch(focus, { ...options, method: "POST" });
  if (!opened.ok) throw new Error("The desktop development instance could not open the page.");
  return url;
}
