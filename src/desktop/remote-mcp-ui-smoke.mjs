// Real hidden Electron UI + native IPC. No mocked bridge, accounts or tunnel provider.
// Build first. SHOWAI_SMOKE_OUTPUT selects retained evidence; an optional
// SHOWAI_TEST_CLOUDFLARED exercises starting/stopping a real Quick connector.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { _electron } from "playwright-core";
import { desktopTestEnvironment } from "../../scripts/desktop-test-env.mjs";
import { stopTestProcess } from "../../scripts/stop-test-process.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const parent = process.env.SHOWAI_SMOKE_OUTPUT ?? join(tmpdir(), "showai-remote-mcp-evidence");
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, "remote-mcp-ui-"));
const fixtures = await mkdtemp(join(tmpdir(), "showai-remote-mcp-ui-"));
const env = { ...desktopTestEnvironment(), SHOWAI_LANGUAGE: "zh-CN", SHOWAI_HOME: join(fixtures, "library"), SHOWAI_USER_DATA: join(fixtures, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SHOWAI_DEV_URL;
const result = { passed: false, output, checks: [], rendererErrors: [] };
let application, page;
let processLog = "";
async function snapshot(name) { await writeFile(join(output, name + ".txt"), await page.locator("body").ariaSnapshot()); }
async function hidden() {
  const windows = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ visible: w.isVisible(), focused: w.isFocused() })));
  assert.ok(windows.every(w => !w.visible && !w.focused), JSON.stringify(windows));
}
try {
  application = await _electron.launch({ executablePath: electron, args: [root], cwd: root, env, timeout: 30000 });
  application.process().stderr?.on("data", data => processLog += data.toString());
  page = await application.firstWindow({ timeout: 30000 });
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => result.rendererErrors.push(error.message));
  await page.getByRole("button", { name: "新建项目", exact: true }).first().waitFor();
  await snapshot("welcome");
  await page.getByRole("button", { name: "新建项目", exact: true }).first().click();
  await page.getByRole("textbox", { name: "项目名称", exact: true }).fill("Remote connection UI verification");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await snapshot("project-created");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await snapshot("settings");
  await page.getByRole("button", { name: "远程连接", exact: true }).click();
  await page.getByRole("button", { name: "开启连接", exact: true }).waitFor();
  await snapshot("remote-initial");
  await hidden();
  assert.equal(await page.getByRole("button", { name: "开启连接", exact: true }).isDisabled(), true);
  await page.getByRole("checkbox", { name: "Remote connection UI verification", exact: true }).check();
  await page.getByRole("combobox", { name: "Remote connection UI verification 的访问权限", exact: true }).selectOption("write");
  assert.equal(await page.getByRole("button", { name: "开启连接", exact: true }).isEnabled(), true);
  result.checks.push("selected project permissions gate startup through the real settings UI");

  await page.getByRole("button", { name: "固定域名", exact: true }).click();
  await snapshot("cloudflare-fixed");
  await page.getByRole("textbox", { name: "公网 HTTPS 地址", exact: true }).fill("http://invalid.example.com");
  await page.getByRole("button", { name: "开启连接", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "HTTPS" }).waitFor();
  assert.equal(await page.locator('input[type="password"]').count(), 1);
  result.checks.push("fixed domain validates HTTPS and masks the tunnel credential");
  await page.screenshot({ path: join(output, "cloudflare-fixed.png") });

  await page.getByRole("button", { name: "Tailscale", exact: true }).click();
  await snapshot("tailscale");
  assert.equal(await page.getByRole("alert").count(), 0, "A previous provider validation error should clear when switching providers.");
  assert.ok((await page.locator(".remote-mcp-settings").innerText()).includes("MagicDNS"));
  assert.equal(await page.locator('input[type="password"]').count(), 0);
  await page.screenshot({ path: join(output, "tailscale-light.png") });
  result.checks.push("provider-specific setup and credentials switch without any account or network reconfiguration");

  await page.getByRole("button", { name: "Cloudflare", exact: true }).click();
  await page.getByText("连接设置", { exact: true }).click();
  await page.getByRole("textbox", { name: "工具路径", exact: true }).fill(join(fixtures, "missing-cloudflared"));
  await page.getByRole("button", { name: "开启连接", exact: true }).click();
  await page.getByText("连接已中断", { exact: true }).waitFor();
  await page.getByRole("alert").filter({ hasText: "ENOENT" }).waitFor();
  result.checks.push("missing executable surfaces the real process boundary error and unlocks configuration");

  if (process.env.SHOWAI_TEST_CLOUDFLARED) {
    await page.getByRole("textbox", { name: "工具路径", exact: true }).fill(process.env.SHOWAI_TEST_CLOUDFLARED);
    await page.getByRole("spinbutton", { name: "本机端口", exact: true }).fill("18798");
    await page.getByRole("button", { name: "开启连接", exact: true }).click();
    await page.getByRole("button", { name: "关闭连接", exact: true }).waitFor();
    await page.getByRole("button", { name: "关闭连接", exact: true }).click();
    await page.getByText("未开启", { exact: true }).waitFor({ timeout: 30000 });
    const status = await page.evaluate(() => window.showai.invoke("remoteMcp:status"));
    assert.equal(status.phase, "stopped");
    assert.equal(status.localUrl, undefined);
    result.checks.push("native IPC starts and cancels the real connector without leaving an MCP listener");
  }
  await page.getByRole("button", { name: "外观", exact: true }).click();
  await page.getByRole("radio", { name: "深色", exact: true }).check();
  await page.getByRole("button", { name: "远程连接", exact: true }).click();
  await page.getByRole("button", { name: "开启连接", exact: true }).waitFor();
  await snapshot("remote-dark");
  await page.screenshot({ path: join(output, "remote-dark.png") });
  const window = await application.browserWindow(page);
  await window.evaluate(window => window.setSize(760, 760));
  await snapshot("remote-narrow");
  const overflow = await page.locator(".remote-mcp-settings").evaluate(el => el.scrollWidth > el.clientWidth + 1);
  assert.equal(overflow, false, "Remote settings overflow the narrow panel.");
  await page.screenshot({ path: join(output, "remote-narrow.png") });
  await page.getByRole("button", { name: "开启连接", exact: true }).focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("button", { name: "Cloudflare", exact: true }).evaluate(el => el === document.activeElement), true);
  await hidden();
  result.checks.push("dark theme, narrow panel and keyboard focus operate while every native window remains hidden");
  assert.deepEqual(result.rendererErrors, []);
  result.passed = true;
} catch (error) {
  result.error = error.stack ?? String(error);
  if (page) { await snapshot("failure").catch(() => {}); await page.screenshot({ path: join(output, "failure.png") }).catch(() => {}); }
  process.exitCode = 1;
} finally {
  if (application) await stopTestProcess(application.process(), () => application.close(), { label: "remote MCP UI test", timeoutMs: 15000 });
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  await writeFile(join(output, "process.log"), processLog);
  await rm(fixtures, { recursive: true, force: true });
  console.log(JSON.stringify(result, null, 2));
}
