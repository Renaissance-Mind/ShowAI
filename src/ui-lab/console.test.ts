import { afterAll, beforeAll, expect, test } from "vitest";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startUiLab } from "./server";
import type { LabSession } from "./types";

let root: string,
  server: Awaited<ReturnType<typeof startUiLab>>,
  browser: Browser,
  context: BrowserContext,
  page: Page;
const errors: string[] = [];
const output = process.env.SHOWAI_UI_LAB_TEST_OUTPUT;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-ui-console-"));
  server = await startUiLab({
    repository: process.cwd(),
    state: join(root, "state"),
    output: join(root, "results"),
  });
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /Could not determine window|createRoot.*already/.test(message.text())
    )
      errors.push(message.text());
  });
  if (output) await mkdir(output, { recursive: true });
  await page.goto(server.url);
}, 30000);
afterAll(async () => {
  await context?.close();
  await browser?.close();
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
const frame = () => page.frameLocator("iframe");
test("the feature selector and its direct link open the interactive workbench motion checks", async () => {
  const review = await context.newPage();
  try {
    await review.goto(server.url + "?feature=workbench-motion");
    const picker = review.getByRole("combobox", { name: "测试功能" });
    await expect.poll(() => picker.inputValue()).toBe("workbench-motion");
    const app = review.frameLocator("iframe");
    const state = (id: string) =>
      expect
        .poll(() => app.locator("html").getAttribute("data-ui-lab-node"), {
          timeout: 20000,
        })
        .toBe(id);
    await state("directory");
    await review.getByRole("button", { name: "标签切换", exact: true }).click();
    await state("tabs");
    await app.getByRole("tab", { name: "访谈提纲", exact: true }).click();
    await app
      .getByRole("tabpanel", { name: "访谈提纲", exact: true })
      .waitFor();
    await review
      .getByRole("button", { name: "多选栏 · 候选", exact: true })
      .click();
    await state("selection-proposal");
    await review
      .getByRole("button", { name: "操作 1：选择「访谈提纲」", exact: true })
      .click();
    await app.getByText("已选 1 项", { exact: true }).waitFor();
    await picker.selectOption("workbench");
    await state("project");
    await picker.selectOption("workbench-motion");
    await state("directory");
    expect(new URL(review.url()).searchParams.get("feature")).toBe(
      "workbench-motion",
    );
  } finally {
    await review.close();
  }
}, 90000);

async function state(id: string) {
  await expect
    .poll(() => frame().locator("html").getAttribute("data-ui-lab-node"), {
      timeout: 20000,
    })
    .toBe(id);
}
async function shot(name: string) {
  if (output)
    await page.screenshot({
      path: join(output, name + ".png"),
      animations: "disabled",
    });
}

test("state and feature switches preserve native focus and leave the console interactive", async () => {
  await state("modes");
  await shot("overview");
  for (let index = 0; index < 3; index++) {
    await page
      .getByRole("combobox", { name: "测试功能", exact: true })
      .selectOption("workbench");
    await state("project");
    expect(
      await frame()
        .locator("html")
        .evaluate(() =>
          HTMLElement.prototype.focus.toString().includes("[native code]"),
        ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "操作 1：新建项目", exact: true })
      .click();
    await state("form");
    await frame()
      .getByRole("textbox", { name: "项目名称", exact: true })
      .fill("交互标注验证 " + index);
    await frame()
      .getByRole("button", { name: "创建项目", exact: true })
      .click();
    await state("created");
    await page
      .getByRole("combobox", { name: "测试功能", exact: true })
      .selectOption("remote-connection");
    await state("modes");
  }
  expect(errors).toEqual([]);
}, 120000);

test("LAN controls align and permission scope has its own interactive panel", async () => {
  await frame()
    .getByRole("button", { name: "配置局域网", exact: true })
    .click();
  await state("lan.setup");
  const address = frame().locator("#remote-bind-address");
  const layout = await address.evaluate((select) => {
    const label = document.querySelector('label[for="remote-bind-address"]')!,
      refresh = document.querySelector<HTMLButtonElement>(
        'button[aria-label="刷新地址"]',
      )!,
      box = select.getBoundingClientRect(),
      l = label.getBoundingClientRect(),
      r = refresh.getBoundingClientRect();
    return {
      gap: box.top - l.bottom,
      arrowSpace: parseFloat(getComputedStyle(select).paddingRight),
      refreshGap: r.left - box.right,
      verticalOffset: Math.abs(r.top - box.top),
    };
  });
  expect(layout.gap).toBeGreaterThanOrEqual(8);
  expect(layout.arrowSpace).toBeGreaterThanOrEqual(32);
  expect(layout.refreshGap).toBeGreaterThanOrEqual(8);
  expect(layout.verticalOffset).toBeLessThan(1);
  await address.click();
  await page.keyboard.press("Escape");
  const focusStyle = () =>
    address.evaluate((el) => ({
      focused: el.matches(":focus"),
      outline: getComputedStyle(el).outlineStyle,
      shadow: getComputedStyle(el).boxShadow,
    }));
  await expect
    .poll(focusStyle)
    .toEqual({ focused: true, outline: "none", shadow: "none" });
  await frame().getByRole("button", { name: "刷新地址" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(focusStyle).toMatchObject({
    focused: true,
    outline: "none",
    shadow: expect.stringContaining("inset"),
  });
  await shot("lan-controls");
  await frame().getByRole("tab", { name: "内容权限", exact: true }).click();
  await state("lan.permissions");
  await frame().getByRole("button", { name: "指定项目", exact: true }).click();
  await state("lan.permissions.selected");
  expect(await frame().locator(".remote-rules,.remote-resume").count()).toBe(0);
  await shot("permissions");
  await page.getByRole("button", { name: "回到起点", exact: true }).click();
  await state("modes");
  expect(errors).toEqual([]);
}, 60000);

test("parallel entrances remain independent when an enabled route is stopped", async () => {
  await page
    .getByRole("region", { name: "界面状态", exact: true })
    .getByRole("button", { name: "多入口同时开启", exact: true })
    .click();
  await state("multiple");
  await frame().locator('[data-connection="lan"] [role="switch"]').click();
  const inspect = async () => {
    const config = await frame()
      .locator("html")
      .evaluate(() => window.__SHOWAI_UI_LAB__!);
    return fetch(
      `${server.origin}/__ui-lab/api/sessions/${config.id}/inspect?fixture=1`,
      { headers: { authorization: `Bearer ${(config as LabSession).token}` } },
    ).then((response) => response.json());
  };
  await expect
    .poll(
      async () =>
        (
          (await inspect()).connections as {
            provider: string;
            enabled: boolean;
          }[]
        ).find((item) => item.provider === "lan")!.enabled,
      { timeout: 10000 },
    )
    .toBe(false);
  const status = await inspect();
  expect(
    status.connections.find(
      (item: { provider: string }) => item.provider === "tailscale-private",
    ).phase,
  ).toBe("running");
  expect(
    status.connections.find(
      (item: { provider: string }) => item.provider === "cloudflare-quick",
    ).phase,
  ).toBe("running");
  await shot("parallel-entrances");
  expect(errors).toEqual([]);
}, 60000);

test("flow branches jump to the message screen and authorization states remain operable", async () => {
  await page.getByRole("button", { name: "回到起点", exact: true }).click();
  await state("modes");
  await page.getByRole("button", { name: "流程树", exact: true }).click();
  for (const id of [
    "modes",
    "funnel.setup",
    "funnel.starting",
    "funnel.ready",
    "funnel.client",
    "funnel.chatgpt",
  ]) {
    const expander = page.locator(
      `[data-flow-node="${id}"] > .flow-tree-row > .flow-expander`,
    );
    if ((await expander.getAttribute("aria-expanded")) === "false")
      await expander.click();
  }
  await page
    .locator(
      '[data-flow-node="funnel.chatgpt.verify"] > .flow-tree-row > button:last-child',
    )
    .click();
  await state("funnel.chatgpt.verify");
  expect(
    await frame()
      .getByText("请使用 ShowAI 列出我的项目。", { exact: true })
      .count(),
  ).toBe(1);
  expect(
    await frame()
      .locator(".rm-message-task .rm-client-status[role=status]")
      .textContent(),
  ).toBe("等待客户端发起授权");
  await shot("client-message");
  await page
    .getByRole("region", { name: "界面状态", exact: true })
    .getByRole("button", { name: "等待审批", exact: true })
    .click();
  await state("funnel.chatgpt.approval");
  await shot("client-approval");
  await frame().getByRole("button", { name: "允许连接", exact: true }).click();
  await state("funnel.chatgpt.authorized");
  expect(errors).toEqual([]);
}, 60000);

test("stopping the selected client connection returns to its network controls", async () => {
  await page.getByRole("button", { name: "回到起点", exact: true }).click();
  await state("modes");
  await frame()
    .getByRole("button", { name: "配置局域网", exact: true })
    .click();
  await state("lan.setup");
  await page
    .getByRole("region", { name: "界面状态", exact: true })
    .getByRole("button", { name: "已开启", exact: true })
    .click();
  await state("lan.ready");
  await frame().getByRole("tab", { name: "客户端", exact: true }).click();
  await state("lan.client");
  await frame()
    .getByRole("switch", { name: "关闭局域网", exact: true })
    .click();
  await state("lan.setup");
  expect(
    await frame()
      .getByRole("tab", { name: "网络配置", exact: true })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(errors).toEqual([]);
}, 60000);
