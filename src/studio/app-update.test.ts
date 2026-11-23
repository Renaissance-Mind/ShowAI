import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  APP_UPDATE_RESTART_DELAY_MS,
  type AppUpdateState,
} from "../host/protocol";
import { getLocale, setLocale } from "../i18n";
import AppUpdateNotice from "./AppUpdateNotice";
import { UpdateOffer } from "./feedback/UpdateOffer";

const previousLocale = getLocale();
beforeEach(() => setLocale("en"));
afterEach(() => setLocale(previousLocale));

function unexpectedAction(): never {
  throw new Error(
    "Rendering an update must not initiate a download or restart",
  );
}

const downloaded: AppUpdateState = {
  supported: true,
  automatic: true,
  currentVersion: "1.0.0",
  phase: "ready",
  version: "1.0.1",
  installMode: "onQuit",
};

it("offers both installation choices and disables them while rechecking", () => {
  const offer = (checking: boolean) =>
    renderToStaticMarkup(
      createElement(UpdateOffer, {
        version: "1.0.1",
        checking,
        onCheck: unexpectedAction,
        onDownload: unexpectedAction,
      }),
    );
  const html = offer(false);
  expect(html).toContain("1.0.1 is available");
  expect(html).toContain("Check again for updates");
  expect(html).toContain("Install and restart");
  expect(html).toContain("Download and update on next launch");
  expect(offer(true).match(/ disabled=""/g)).toHaveLength(2);
});

it("only offers a nonmodal countdown for a ready download with an active restart deadline", () => {
  const render = (state: AppUpdateState) =>
    renderToStaticMarkup(
      createElement(AppUpdateNotice, { state, run: unexpectedAction }),
    );
  expect(render(downloaded)).toBe("");
  const restart = {
    ...downloaded,
    installMode: "restart" as const,
    restartAt: Date.now() + APP_UPDATE_RESTART_DELAY_MS,
  };
  expect(render({ ...restart, phase: "downloading", percent: 100 })).toBe("");
  const html = render(restart);
  expect(html).toContain("Restart now (20s)");
  expect(html).toContain("Restart later");
  expect(html).not.toContain("aria-modal");
  expect(render({ ...restart, phase: "installing" })).toBe("");
});
