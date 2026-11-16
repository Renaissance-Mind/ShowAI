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
        await page.locator(".remote-approval-code").innerText()
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
  await page.getByRole("button", { name: "同一局域网", exact: true }).waitFor();
  await snapshot("network-modes");
  assert.equal(
    await page
      .getByRole("button", { name: "Tailscale 私网", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page.getByRole("button", { name: "公网访问", exact: true }).count(),
    1,
  );
  await page.screenshot({
    animations: "disabled",
    path: join(output, "network-modes-light.png"),
  });
  result.checks.push(
    "network-first entry separates LAN, private Tailscale and public access",
  );

  await page.getByRole("button", { name: "访问规则", exact: true }).click();
  await page
    .getByRole("combobox", { name: "项目范围", exact: true })
    .selectOption("selected");
  await page
    .getByRole("combobox", {
      name: "Remote flow verification 的权限",
      exact: true,
    })
    .selectOption("read");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  assert.ok(
    (await page.locator(".remote-rules").innerText()).includes("指定项目"),
  );
  await page.getByRole("button", { name: "访问规则", exact: true }).click();
  await page
    .getByRole("combobox", { name: "项目范围", exact: true })
    .selectOption("all");
  await page.getByRole("button", { name: "保存", exact: true }).click();

  await page.getByRole("button", { name: "同一局域网", exact: true }).click();
  const addresses = page.getByRole("combobox", {
    name: "本机网络地址",
    exact: true,
  });
  if (await addresses.locator("option:not([disabled])").count()) {
    await page
      .getByRole("button", { name: "开启局域网连接", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "在客户端添加服务器", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "下载 ChatGPT 插件 ZIP", exact: true })
        .count(),
      0,
    );
    await page
      .getByRole("textbox", { name: "客户端名称", exact: true })
      .fill("UI LAN acceptance");
    await page
      .getByRole("button", { name: "创建并复制访问密钥", exact: true })
      .click();
    await page
      .getByRole("button", { name: "已填写地址和密钥，验证连接", exact: true })
      .waitFor();
    const token = await application.evaluate(({ clipboard }) =>
      clipboard.readText(),
    );
    const status = await page.evaluate(() =>
      window.showai.invoke("remoteMcp:status"),
    );
    assert.equal(status.config.provider, "lan");
    assert.ok(status.url.startsWith("http://"));
    assert.ok(!JSON.stringify(status).includes(token));
    await page.screenshot({
      animations: "disabled",
      path: join(output, "lan-client-key.png"),
    });
    await page
      .getByRole("button", { name: "已填写地址和密钥，验证连接", exact: true })
      .click();
    const response = await fetch(status.url, {
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
    await page
      .getByRole("heading", { name: "客户端已成功调用", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "撤销授权", exact: true }).click();
    assert.equal(
      (
        await fetch(status.url, {
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
    await page.getByRole("button", { name: "断开连接", exact: true }).click();
    result.checks.push(
      "real LAN UI creates and copies a key, records an authenticated MCP call, and revokes it immediately",
    );
  } else {
    result.checks.push("LAN UI reports no available interface on this host");
    await page.getByRole("button", { name: "返回", exact: true }).click();
  }
  await page
    .getByRole("button", { name: "Tailscale 私网", exact: true })
    .click();
  assert.ok(
    (await page.locator(".remote-flow").innerText()).includes("仅限私网访问"),
  );
  await page.screenshot({
    animations: "disabled",
    path: join(output, "tailscale-private-setup.png"),
  });
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "公网访问", exact: true }).click();
  await page
    .getByRole("button", { name: "Cloudflare 固定域名", exact: false })
    .click();
  await page
    .getByRole("button", { name: "复制本机地址", exact: true })
    .waitFor();
  const prepared = await page.evaluate(() =>
    window.showai.invoke("remoteMcp:status"),
  );
  assert.equal(prepared.phase, "prepared");
  await verifyDesktopApproval(prepared.localUrl);
  await page.getByRole("button", { name: "复制本机地址", exact: true }).click();
  const reserved = await page.evaluate(() =>
    window.showai.invoke("remoteMcp:status"),
  );
  assert.equal(prepared.localUrl, reserved.localUrl);
  await page.getByRole("button", { name: "返回", exact: true }).click();

  await page.getByRole("button", { name: "外观", exact: true }).click();
  await page.getByRole("radio", { name: "深色", exact: true }).check();
  await page.getByRole("button", { name: "远程连接", exact: true }).click();
  const window = await application.browserWindow(page);
  await window.evaluate((w) => w.setSize(760, 820));
  await page.getByRole("button", { name: "同一局域网", exact: true }).focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .getByRole("button", { name: "Tailscale 私网", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(
    await page
      .locator(".remote-flow")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
    false,
  );
  await page.screenshot({
    animations: "disabled",
    path: join(output, "network-modes-dark-narrow.png"),
  });
  const windows = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      visible: w.isVisible(),
      focused: w.isFocused(),
    })),
  );
  assert.ok(windows.every((w) => !w.visible && !w.focused));
  result.checks.push(
    "dark/narrow layout and keyboard navigation work in hidden Electron",
  );

  if (process.env.SHOWAI_TEST_TAILSCALE) {
    await page.getByRole("button", { name: "公网访问", exact: true }).click();
    await page
      .getByRole("button", { name: "Tailscale 公网（Funnel）", exact: false })
      .click();
    await page.getByRole("button", { name: "检查并连接", exact: true }).click();
    await page
      .getByRole("heading", { name: "连接哪个客户端？", exact: true })
      .waitFor({ timeout: 90000 });
    await page.getByRole("button", { name: "ChatGPT", exact: false }).click();
    await page
      .getByRole("heading", { name: "添加 MCP 服务器", exact: true })
      .waitFor();
    assert.equal(
      await page
        .locator(".remote-chatgpt-guide > dl .remote-field-guide")
        .count(),
      4,
    );
    await page.screenshot({
      animations: "disabled",
      path: join(output, "chatgpt-server-dark-narrow.png"),
    });
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    assert.equal(
      await page
        .getByRole("heading", { name: "设置 OAuth", exact: true })
        .count(),
      1,
    );
    await page
      .getByRole("button", { name: "处理自动发现失败", exact: true })
      .click();
    await page.getByText("查看 OAuth 端点", { exact: true }).click();
    const publicStatus = await page.evaluate(() =>
      window.showai.invoke("remoteMcp:status"),
    );
    assert.ok(
      (await page.getByRole("dialog").innerText()).includes(
        new URL(publicStatus.url).origin + "/oauth/token",
      ),
    );
    await page.keyboard.press("Escape");
    await page.screenshot({
      animations: "disabled",
      path: join(output, "chatgpt-oauth-dark-narrow.png"),
    });
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    assert.equal(
      await page
        .getByRole("heading", { name: "创建并连接", exact: true })
        .count(),
      1,
    );
    await page.getByRole("button", { name: "上一步", exact: true }).click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page
      .getByRole("button", { name: "已打开 ShowAI 授权页，继续", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "验证客户端调用", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "生成配对码", exact: true })
        .count(),
      0,
    );
    await page
      .getByRole("button", { name: "更改连接方式", exact: true })
      .click();
    result.checks.push(
      "live Funnel supports client choice and the three-step ChatGPT guide with back navigation and discovery recovery",
    );
  }
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
      .evaluate(() => window.showai.invoke("remoteMcp:stop"))
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
