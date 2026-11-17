import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { _electron } from "playwright-core";
import { desktopTestEnvironment } from "../../scripts/desktop-test-env.mjs";
import { stopTestProcess } from "../../scripts/stop-test-process.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const parent =
  process.env.SHOWAI_SMOKE_OUTPUT ??
  join(tmpdir(), "showai-remote-flow-evidence");
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, "remote-flow-ui-"));
const fixtures = await mkdtemp(join(tmpdir(), "showai-remote-flow-"));
const env = {
  ...desktopTestEnvironment(),
  SHOWAI_LANGUAGE: "zh-CN",
  SHOWAI_HOME: join(fixtures, "library"),
  SHOWAI_USER_DATA: join(fixtures, "profile"),
  SHOWAI_AGENT_WORKSPACES: join(fixtures, "agent-workspaces"),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.SHOWAI_DEV_URL;
const result = { passed: false, output, checks: [], rendererErrors: [] };
let application,
  page,
  processLog = "";
const snapshot = async (name) =>
  writeFile(
    join(output, name + ".txt"),
    await page.locator("body").ariaSnapshot(),
  );
async function verifyDesktopApproval(origin, layout = "light") {
  let finish;
  const callback = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<title>Connection complete</title>Connection complete");
    if (request.url.startsWith("/callback"))
      finish(new URL(request.url, "http://127.0.0.1"));
  });
  await new Promise((resolve) => callback.listen(0, "127.0.0.1", resolve));
  const redirect = `http://127.0.0.1:${callback.address().port}/callback`;
  try {
    for (const decision of ["deny", "allow"]) {
      const received = new Promise((resolve) => (finish = resolve));
      const registration = await fetch(origin + "/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Desktop approval acceptance",
          redirect_uris: [redirect],
          token_endpoint_auth_method: "none",
        }),
      }).then((r) => r.json());
      const verifier = randomBytes(32).toString("base64url");
      const authorizationUrl =
        origin +
        "/oauth/authorize?" +
        new URLSearchParams({
          client_id: registration.client_id,
          redirect_uri: redirect,
          response_type: "code",
          code_challenge_method: "S256",
          code_challenge: createHash("sha256")
            .update(verifier)
            .digest("base64url"),
          resource: origin + "/mcp",
          scope: "projects.read projects.write projects.create",
          state: "ui-approval",
        });
      const windowReady = application.waitForEvent("window");
      await application.evaluate(({ BrowserWindow }, url) => {
        const browser = new BrowserWindow({
          show: false,
          webPreferences: { sandbox: true, contextIsolation: true },
        });
        void browser.loadURL(url);
      }, authorizationUrl);
      const browser = await windowReady;
      await browser
        .getByRole("heading", { name: "等待 ShowAI 本机确认", exact: true })
        .waitFor();
      assert.equal(
        await browser.locator('input[name="pairingCode"]').count(),
        0,
      );
      await page
        .getByRole("dialog", { name: "允许这次远程连接？", exact: true })
        .waitFor();
      const number = (
        await page.locator(".rm-approval-code").innerText()
      ).trim();
      assert.equal((await browser.locator("code").innerText()).trim(), number);
      await page.screenshot({
        animations: "disabled",
        path: join(output, `local-approval-${layout}-${decision}.png`),
      });
      await browser.screenshot({
        animations: "disabled",
        path: join(output, `authorization-wait-${layout}-${decision}.png`),
      });
      await page
        .getByRole("button", {
          name: decision === "allow" ? "允许连接" : "拒绝",
          exact: true,
        })
        .click();
      const destination = await Promise.race([
        received,
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(new Error("Authorization did not return automatically")),
            10000,
          ).unref(),
        ),
      ]);
      assert.equal(destination.searchParams.get("state"), "ui-approval");
      if (decision === "deny")
        assert.equal(destination.searchParams.get("error"), "access_denied");
      else {
        const token = await fetch(origin + "/oauth/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: registration.client_id,
            grant_type: "authorization_code",
            code: destination.searchParams.get("code"),
            redirect_uri: redirect,
            code_verifier: verifier,
            resource: origin + "/mcp",
          }),
        }).then((r) => r.json());
        assert.ok(token.access_token);
      }
      await browser.close();
    }
    result.checks.push(
      "real browser authorization waits for the matching desktop dialog; Deny and Allow return automatically, without a pairing code",
    );
  } finally {
    await new Promise((resolve) => callback.close(resolve));
  }
}
try {
  application = await _electron.launch({
    executablePath: electron,
    args: [root],
    cwd: root,
    env,
    timeout: 30000,
  });
  application
    .process()
    .stderr?.on("data", (data) => (processLog += data.toString()));
  page = await application.firstWindow({ timeout: 30000 });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => result.rendererErrors.push(error.message));
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  await snapshot("welcome");
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "项目名称", exact: true })
    .fill("Remote flow verification");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "远程连接", exact: true }).click();
  const shot = async (name) => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    await page.screenshot({
      animations: "disabled",
      path: join(output, name + ".png"),
    });
  };
  await application.evaluate(({ app, BrowserWindow }) => {
    global.__REMOTE_FOCUS_EVENTS__ = [];
    const observe = (window) => {
      for (const event of ["show", "focus"])
        window.on(event, () => global.__REMOTE_FOCUS_EVENTS__.push(event));
    };
    BrowserWindow.getAllWindows().forEach(observe);
    app.on("browser-window-created", (_event, window) => observe(window));
    app.on("activate", () => global.__REMOTE_FOCUS_EVENTS__.push("activate"));
  });
  const status = (provider) =>
    page.evaluate(
      (provider) => window.showai.invoke("remoteMcp:status", { provider }),
      provider,
    );
  const button = (name) => page.getByRole("button", { name, exact: true });
  const tab = (name) => page.getByRole("tab", { name, exact: true });
  for (const name of [
    "局域网",
    "Tailscale 私网",
    "Tailscale 公网",
    "Cloudflare 临时域名",
    "Cloudflare 自有域名",
  ])
    await button("配置" + name).waitFor();
  assert.equal((await status()).connections.length, 5);
  await shot("network-modes-light");
  result.checks.push(
    "all five independent connection profiles are available in the real desktop IPC",
  );

  await button("配置局域网").click();
  await tab("内容权限").click();
  await button("指定项目").click();
  await button("Remote flow verification：只读").click();
  await button("保存配置").click();
  assert.deepEqual(
    (await status("lan")).config.projects.map((p) => p.write),
    [false],
  );
  await shot("project-permissions");
  await button("全部项目").click();
  await button("保存配置").click();
  await tab("网络配置").click();
  const addresses = page.getByRole("combobox", {
    name: "本机网络地址",
    exact: true,
  });
  if (await addresses.locator("option:not([disabled])").count()) {
    await button("开启连接").click();
    await page.locator('.rm-client-area[data-client-view="setup"]').waitFor();
    assert.equal(await button("ChatGPT").count(), 0);
    await page
      .getByRole("textbox", { name: "客户端名称", exact: true })
      .fill("UI LAN acceptance");
    await button("生成密钥").click();
    const token = await page.locator("#remote-access-key").inputValue();
    const lan = await status("lan");
    assert.ok(token.length > 20);
    assert.ok(lan.url.startsWith("http://"));
    assert.ok(!JSON.stringify(lan).includes(token));
    await shot("lan-client-key");
    await button("去客户端发送消息").click();
    await shot("lan-client-message");
    const response = await fetch(lan.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "projects_list", arguments: {} },
      }),
    }).then((r) => r.json());
    assert.notEqual(response.result?.isError, true);
    assert.ok(response.result);
    await page.locator('.rm-client-area[data-client-view="list"]').waitFor();
    await button("撤销UI LAN acceptance的授权").click();
    assert.equal(
      (
        await fetch(lan.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: "{}",
        })
      ).status,
      401,
    );
    await page.getByRole("switch", { name: "关闭局域网", exact: true }).click();
    await tab("网络配置").waitFor();
    await page
      .locator('[role="tab"][aria-selected="true"]')
      .filter({ hasText: "网络配置" })
      .waitFor();
    assert.equal((await status("lan")).phase, "stopped");
    result.checks.push(
      "real LAN key authenticates an MCP call, reaches the client list, revokes immediately and returns to network controls on shutdown",
    );
  } else
    result.checks.push("LAN UI reports no available interface on this host");
  await button("返回连接列表").click();

  await button("配置Tailscale 私网").click();
  await page
    .getByRole("combobox", { name: "HTTPS 端口", exact: true })
    .waitFor();
  await shot("tailscale-private-setup");
  await button("返回连接列表").click();
  await button("配置Cloudflare 自有域名").click();
  await page.waitForFunction(
    async () =>
      (
        await window.showai.invoke("remoteMcp:status", {
          provider: "cloudflare",
        })
      ).config.port > 0,
  );
  const saved = await status("cloudflare");
  const prepared = await page.evaluate(
    (config) => window.showai.invoke("remoteMcp:prepare", { config }),
    saved.config,
  );
  await verifyDesktopApproval(prepared.localUrl);
  const reserved = await page.evaluate(
    (config) => window.showai.invoke("remoteMcp:prepare", { config }),
    prepared.config,
  );
  assert.equal(prepared.localUrl, reserved.localUrl);
  assert.equal((await status("lan")).phase, "stopped");
  await shot("cloudflare-origin");
  await page.evaluate(() =>
    window.showai.invoke("remoteMcp:stop", { provider: "cloudflare" }),
  );
  await button("返回连接列表").click();

  await button("外观").click();
  await page.getByRole("radio", { name: "深色", exact: true }).check();
  await button("远程连接").click();
  const window = await application.browserWindow(page);
  await window.evaluate((w) => w.setSize(800, 1000));
  await button("配置局域网").focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .getByRole("switch", { name: "启用Tailscale 私网", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(
    await page
      .locator(".remote-settings")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
    false,
  );
  await shot("network-modes-dark-narrow");
  result.checks.push(
    "dark narrow layout and keyboard order work in hidden Electron",
  );

  if (process.env.SHOWAI_TEST_TAILSCALE) {
    await button("配置Tailscale 公网").click();
    await button("开启连接").click();
    await page
      .locator('.rm-client-area[data-client-view="setup"]')
      .waitFor({ timeout: 90000 });
    await button("ChatGPT").click();
    await button("OAuth 端点").click();
    const publicStatus = await status("tailscale");
    assert.ok(
      (await page.locator(".rm-client-recipe").innerText()).includes(
        new URL(publicStatus.url).origin + "/oauth/token",
      ),
    );
    await shot("chatgpt-oauth-dark-narrow");
    await button("去客户端发送消息").click();
    await page.locator('.rm-client-area[data-client-view="verify"]').waitFor();
    await verifyDesktopApproval(
      new URL(publicStatus.url).origin,
      "funnel-dark",
    );
    await page.evaluate(() =>
      window.showai.invoke("remoteMcp:stop", { provider: "tailscale" }),
    );
    result.checks.push(
      "live Funnel supports ChatGPT parameters, OAuth endpoints, client messages and real desktop approval",
    );
  }
  const focus = await application.evaluate(({ BrowserWindow }) => ({
    windows: BrowserWindow.getAllWindows().map((w) => ({
      visible: w.isVisible(),
      focused: w.isFocused(),
    })),
    events: global.__REMOTE_FOCUS_EVENTS__,
  }));
  assert.ok(focus.windows.every((w) => !w.visible && !w.focused));
  assert.deepEqual(focus.events, []);
  result.focus = focus;
  assert.deepEqual(result.rendererErrors, []);
  result.passed = true;
} catch (error) {
  result.error = error.stack ?? String(error);
  process.exitCode = 1;
  if (page)
    result.remoteFailure = await page
      .evaluate(async () => {
        const s = await window.showai.invoke("remoteMcp:status");
        return { phase: s.phase, error: s.error, diagnostics: s.diagnostics };
      })
      .catch(() => undefined);
  if (page) {
    await snapshot("failure").catch(() => {});
    await page
      .screenshot({ animations: "disabled", path: join(output, "failure.png") })
      .catch(() => {});
  }
} finally {
  if (page)
    await page
      .evaluate(async () => {
        for (const provider of [
          "lan",
          "tailscale-private",
          "tailscale",
          "cloudflare-quick",
          "cloudflare",
        ])
          await window.showai.invoke("remoteMcp:stop", { provider });
      })
      .catch(() => {});
  if (application)
    await stopTestProcess(application.process(), () => application.close(), {
      label: "remote flow UI test",
      timeoutMs: 15000,
    });
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  await writeFile(join(output, "process.log"), processLog);
  await rm(fixtures, { recursive: true, force: true });
  console.log(JSON.stringify(result, null, 2));
}
