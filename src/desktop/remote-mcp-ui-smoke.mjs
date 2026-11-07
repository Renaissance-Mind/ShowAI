// Real hidden Electron acceptance for the remote connection wizard. No mocked bridge/provider.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {createHash, randomBytes} from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { _electron } from "playwright-core";
import { desktopTestEnvironment } from "../../scripts/desktop-test-env.mjs";
import { stopTestProcess } from "../../scripts/stop-test-process.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const parent = process.env.SHOWAI_SMOKE_OUTPUT ?? join(tmpdir(), "showai-remote-flow-evidence");
await mkdir(parent, {recursive:true});
const output = await mkdtemp(join(parent,"remote-flow-ui-"));
const fixtures = await mkdtemp(join(tmpdir(),"showai-remote-flow-"));
const env = {...desktopTestEnvironment(),SHOWAI_LANGUAGE:"zh-CN",SHOWAI_HOME:join(fixtures,"library"),SHOWAI_USER_DATA:join(fixtures,"profile")};
delete env.ELECTRON_RUN_AS_NODE; delete env.SHOWAI_DEV_URL;
const result={passed:false,output,checks:[],rendererErrors:[]};
let application,page,processLog="";
const snapshot=async name=>writeFile(join(output,name+".txt"),await page.locator("body").ariaSnapshot());
async function verifyDesktopApproval(origin, layout="light") {
  let finish;
  const callback = createServer((request,response)=>{
    response.writeHead(200,{"content-type":"text/html"});response.end("<title>Connection complete</title>Connection complete");
    if(request.url.startsWith("/callback")) finish(new URL(request.url,"http://127.0.0.1"));
  });
  await new Promise(resolve=>callback.listen(0,"127.0.0.1",resolve));
  const redirect=`http://127.0.0.1:${callback.address().port}/callback`;
  try {
    for(const decision of ["deny","allow"]) {
      const received = new Promise(resolve=>finish=resolve);
      const registration = await fetch(origin+"/oauth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({client_name:"Desktop approval acceptance",redirect_uris:[redirect],token_endpoint_auth_method:"none"})}).then(r=>r.json());
      const verifier=randomBytes(32).toString("base64url");
      const authorizationUrl=origin+"/oauth/authorize?"+new URLSearchParams({client_id:registration.client_id,redirect_uri:redirect,response_type:"code",code_challenge_method:"S256",code_challenge:createHash("sha256").update(verifier).digest("base64url"),resource:origin+"/mcp",scope:"projects.read projects.write projects.create",state:"ui-approval"});
      const windowReady=application.waitForEvent("window");
      await application.evaluate(({BrowserWindow},url)=>{const browser=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});void browser.loadURL(url);},authorizationUrl);
      const browser=await windowReady;
      await browser.getByRole("heading",{name:"等待 ShowAI 本机确认",exact:true}).waitFor();
      assert.equal(await browser.locator('input[name="pairingCode"]').count(),0);
      await page.getByRole("dialog",{name:"允许这次远程连接？",exact:true}).waitFor();
      const number=(await page.locator('.remote-approval-code').innerText()).trim();
      assert.equal((await browser.locator("code").innerText()).trim(),number);
      await page.screenshot({animations:"disabled",path:join(output,`local-approval-${layout}-${decision}.png`)});
      await browser.screenshot({animations:"disabled",path:join(output,`authorization-wait-${layout}-${decision}.png`)});
      await page.getByRole("button",{name:decision==="allow"?"允许连接":"拒绝",exact:true}).click();
      const destination=await Promise.race([received,new Promise((_,reject)=>setTimeout(()=>reject(new Error("Authorization did not return automatically")),10000).unref())]);
      assert.equal(destination.searchParams.get("state"),"ui-approval");
      if(decision==="deny")assert.equal(destination.searchParams.get("error"),"access_denied");
      else {
        const token=await fetch(origin+"/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:registration.client_id,grant_type:"authorization_code",code:destination.searchParams.get("code"),redirect_uri:redirect,code_verifier:verifier,resource:origin+"/mcp"})}).then(r=>r.json());
        assert.ok(token.access_token);
      }
      await browser.close();
    }
    result.checks.push("real browser authorization waits for the matching desktop dialog; Deny and Allow return automatically, without a pairing code");
  } finally {await new Promise(resolve=>callback.close(resolve));}
}
try {
  application=await _electron.launch({executablePath:electron,args:[root],cwd:root,env,timeout:30000});
  application.process().stderr?.on("data",data=>processLog+=data.toString());
  page=await application.firstWindow({timeout:30000});page.setDefaultTimeout(15000);
  page.on("pageerror",error=>result.rendererErrors.push(error.message));
  await page.getByRole("button",{name:"新建项目",exact:true}).first().waitFor();
  await snapshot("welcome");
  await page.getByRole("button",{name:"新建项目",exact:true}).first().click();
  await page.getByRole("textbox",{name:"项目名称",exact:true}).fill("Remote flow verification");
  await page.getByRole("button",{name:"创建项目",exact:true}).click();
  await page.getByRole("button",{name:"设置",exact:true}).click();
  await page.getByRole("button",{name:"远程连接",exact:true}).click();
  await page.getByRole("button",{name:"Cloudflare",exact:true}).waitFor();
  await snapshot("providers");
  assert.ok((await page.locator(".remote-flow").innerText()).includes("全部项目 · 完全权限"));
  assert.equal(await page.locator('.remote-flow details,.remote-flow [role="switch"],.remote-flow [aria-pressed],.remote-flow input[type="checkbox"]').count(),0);
  const logos=await page.locator('.remote-provider-cards img').evaluateAll(images=>images.map(image=>({src:image.src,loaded:image.complete&&image.naturalWidth>0})));
  assert.equal(logos.length,3);assert.ok(logos.every(image=>image.loaded));
  await page.screenshot({animations:"disabled",path:join(output,"providers-light.png")});
  result.checks.push("official provider logos, full-library default and a wizard without switches or disclosure tutorials");

  await page.getByRole("button",{name:"访问规则",exact:true}).click();
  await page.getByRole("combobox",{name:"项目范围",exact:true}).selectOption("selected");
  await page.getByRole("combobox",{name:"Remote flow verification 的权限",exact:true}).selectOption("read");
  await page.getByRole("button",{name:"保存",exact:true}).click();
  assert.ok((await page.locator(".remote-rules").innerText()).includes("指定项目"));
  await page.getByRole("button",{name:"访问规则",exact:true}).click();
  await page.getByRole("combobox",{name:"项目范围",exact:true}).selectOption("all");
  await page.getByRole("button",{name:"保存",exact:true}).click();
  result.checks.push("optional access rules are edited in a dialog and default full access can be restored");

  await page.getByRole("button",{name:"Cloudflare",exact:true}).click();
  await snapshot("cloudflare-methods");
  await page.getByRole("button",{name:"连接自己的域名",exact:false}).click();
  await page.getByRole("button",{name:"复制本机地址",exact:true}).waitFor();
  const prepared=await page.evaluate(()=>window.showai.invoke("remoteMcp:status"));
  assert.equal(prepared.phase,"prepared");assert.ok(prepared.config.port>0);
  assert.equal((await fetch(prepared.localUrl+"/health")).status,200);
  assert.equal(await page.getByRole("textbox",{name:"HTTPS 域名",exact:true}).count(),0);
  await page.getByRole("button",{name:"复制本机地址",exact:true}).click();
  await page.getByRole("link",{name:"打开 Cloudflare 控制台",exact:true}).waitFor();
  await page.getByRole("button",{name:"路由已配置，继续",exact:true}).click();
  await page.getByRole("textbox",{name:"HTTPS 域名",exact:true}).fill("https://showai.example.com");
  assert.equal(await page.locator('input[type="password"]').count(),1);
  const again=await page.evaluate(()=>window.showai.invoke("remoteMcp:status"));
  assert.equal(again.localUrl,prepared.localUrl);
  await verifyDesktopApproval(prepared.localUrl);
  await snapshot("owned-domain");
  await page.screenshot({animations:"disabled",path:join(output,"owned-domain.png")});
  await page.getByRole("button",{name:"返回",exact:true}).click();
  await page.getByRole("button",{name:"Tailscale",exact:true}).waitFor();
  await assert.rejects(fetch(prepared.localUrl+"/health"));
  result.checks.push("fixed-domain setup reserves a real port, advances via copy/configure actions and releases it on Back");

  await page.getByRole("button",{name:"Tailscale",exact:true}).click();
  await page.getByRole("button",{name:"已登录，检查并连接",exact:true}).waitFor();
  assert.equal(await page.getByRole("link",{name:"安装并登录 Tailscale",exact:true}).count(),1);
  assert.equal(await page.getByRole("link",{name:"打开网络设置",exact:true}).count(),1);
  await page.screenshot({animations:"disabled",path:join(output,"tailscale-setup.png")});
  await page.getByRole("button",{name:"返回",exact:true}).click();
  await page.getByRole("button",{name:"Cloudflare",exact:true}).click();
  await page.getByRole("button",{name:"创建临时连接",exact:false}).click();
  await page.getByRole("button",{name:"选择连接工具",exact:true}).click();
  await page.getByRole("textbox",{name:"程序路径",exact:true}).fill(join(fixtures,"missing-connector"));
  await page.getByRole("button",{name:"继续",exact:true}).click();
  await page.getByRole("button",{name:"建立连接",exact:true}).click();
  await page.getByRole("button",{name:"查看诊断",exact:true}).waitFor();
  await page.getByRole("button",{name:"查看诊断",exact:true}).click();
  assert.ok((await page.getByRole("dialog").innerText()).includes("ENOENT"));
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"返回",exact:true}).click();
  result.checks.push("Tailscale setup actions and real missing-tool recovery stay inside the current step");

  await page.getByRole("button",{name:"外观",exact:true}).click();
  await page.getByRole("radio",{name:"深色",exact:true}).check();
  await page.getByRole("button",{name:"远程连接",exact:true}).click();
  await page.getByRole("button",{name:"Cloudflare",exact:true}).waitFor();
  const window=await application.browserWindow(page);await window.evaluate(w=>w.setSize(760,760));
  await page.getByRole("button",{name:"Cloudflare",exact:true}).focus();await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("button",{name:"Tailscale",exact:true}).evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.locator(".remote-flow").evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
  await page.screenshot({animations:"disabled",path:join(output,"providers-dark-narrow.png")});
  const windows=await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused()})));
  assert.ok(windows.every(w=>!w.visible&&!w.focused));
  result.checks.push("dark/narrow layout and keyboard flow work with all native windows hidden");
  await page.getByRole("button",{name:"Cloudflare",exact:true}).click();
  await page.getByRole("button",{name:"连接自己的域名",exact:false}).click();
  await page.getByRole("button",{name:"复制本机地址",exact:true}).waitFor();
  const darkPrepared=await page.evaluate(()=>window.showai.invoke("remoteMcp:status"));
  await verifyDesktopApproval(darkPrepared.localUrl,"dark-narrow");
  await page.getByRole("button",{name:"返回",exact:true}).click();

  if (process.env.SHOWAI_TEST_PUBLIC_TUNNEL === "1") {
    await page.getByRole("button",{name:"Cloudflare",exact:true}).click();
    await page.getByRole("button",{name:"创建临时连接",exact:false}).click();
    await page.getByRole("button",{name:"选择连接工具",exact:true}).click();
    await page.getByRole("textbox",{name:"程序路径",exact:true}).fill("");
    await page.getByRole("button",{name:"继续",exact:true}).click();
    await page.getByRole("button",{name:/^(建立连接|下载工具并连接)$/}).click();
    const readyButton=page.getByRole("button",{name:"复制 MCP 地址",exact:true});
    const retryButton=page.getByRole("button",{name:"重新检查并连接",exact:true});
    await readyButton.or(retryButton).first().waitFor({timeout:120000});
    for(let retry=0;retry<2 && await retryButton.isVisible();retry++) {
      await retryButton.click();
      await page.waitForFunction(()=>document.querySelector('.remote-flow')?.getAttribute('aria-busy')==='false');
    }
    await readyButton.waitFor({timeout:15000});
    await page.getByRole("button",{name:"复制 MCP 地址",exact:true}).click();
    const status = await page.evaluate(()=>window.showai.invoke("remoteMcp:status"));
    const origin = new URL(status.url).origin;
    const metadata = await fetch(origin + "/.well-known/oauth-authorization-server").then(r=>r.json());
    for (const value of [metadata.authorization_endpoint,metadata.token_endpoint,metadata.registration_endpoint,metadata.issuer]) assert.ok(value);
    assert.equal(await page.getByRole("button",{name:"生成配对码",exact:true}).count(),0);
    await page.getByRole("button",{name:"处理自动发现失败",exact:true}).click();
    for (const value of [metadata.authorization_endpoint,metadata.token_endpoint,metadata.registration_endpoint,metadata.issuer,status.url]) assert.ok((await page.getByRole("dialog").innerText()).includes(value));
    await page.getByRole("button",{name:"重新检查 ShowAI 服务",exact:true}).click();
    await page.getByRole("status").filter({hasText:"本机服务检查通过"}).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("button",{name:"处理自动发现失败",exact:true}).evaluate(el=>el===document.activeElement),true);
    assert.equal(await page.locator(".remote-flow").evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    await page.screenshot({animations:"disabled",path:join(output,"chatgpt-guide-dark-narrow.png")});
    await page.getByRole("button",{name:"已打开 ShowAI 授权页，继续",exact:true}).click();
    assert.equal(await page.getByRole("button",{name:"生成配对码",exact:true}).count(),0);
    assert.ok((await page.locator(".remote-flow").innerText()).includes("允许连接"));
    await page.getByRole("button",{name:"授权窗口已失效",exact:true}).click();
    assert.ok((await page.getByRole("dialog").innerText()).includes("确认新的连接请求"));
    await page.keyboard.press("Escape");
    await page.getByRole("button",{name:"断开连接",exact:true}).click();
    result.checks.push("live Quick Tunnel discovery values match the inline form; ZIP entry, manual setup and authorization recovery work in dark narrow Electron");
  }
  assert.deepEqual(result.rendererErrors,[]);result.passed=true;
} catch(error) {
  result.error=error.stack??String(error);process.exitCode=1;
  if(page) result.remoteFailure=await page.evaluate(async()=>{const s=await window.showai.invoke("remoteMcp:status");return {phase:s.phase,error:s.error,diagnostics:s.diagnostics};}).catch(()=>undefined);
  if(page){await snapshot("failure").catch(()=>{});await page.screenshot({animations:"disabled",path:join(output,"failure.png")}).catch(()=>{});}
} finally {
  if(page)await page.evaluate(()=>window.showai.invoke("remoteMcp:stop")).catch(()=>{});
  if(application)await stopTestProcess(application.process(),()=>application.close(),{label:"remote flow UI test",timeoutMs:15000});
  await writeFile(join(output,"result.json"),JSON.stringify(result,null,2));await writeFile(join(output,"process.log"),processLog);
  await rm(fixtures,{recursive:true,force:true});console.log(JSON.stringify(result,null,2));
}
