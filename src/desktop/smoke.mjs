// Runs the actual Electron binary against an isolated data directory and built UI.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import electron from "electron";
import { stopTestProcess } from "../../scripts/stop-test-process.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporary = await mkdtemp(join(tmpdir(), "showai-desktop-smoke-"));
const packagedExecutable = process.argv[2]
  ? resolve(process.argv[2])
  : undefined;
async function availablePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
const rendererPort = await availablePort(),
  mainPort = await availablePort();
const environment = {
  ...process.env,
  SHOWAI_HOME: join(temporary, "home"),
  SHOWAI_USER_DATA: join(temporary, "profile"),
};
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.SHOWAI_VIEWER;
delete environment.ESBUILD_BINARY_PATH;
delete environment.NODE_PATH;
delete environment.SHOWAI_RUNTIME_ENTRY;
const child = spawn(
  packagedExecutable ?? electron,
  [
    `--inspect=${mainPort}`,
    ...(packagedExecutable ? [] : [join(repository, "dist-desktop/main.mjs")]),
    `--remote-debugging-port=${rendererPort}`,
  ],
  {
    cwd: packagedExecutable ? temporary : repository,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stderr.on("data", (chunk) => {
  output += chunk;
});
child.stdout.on("data", (chunk) => {
  output += chunk;
});
const sockets = [];
let inspectMain;

async function connect(port) {
  let target;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Electron exited: ${output}`);
    const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(
      () => null,
    );
    if (response?.ok) {
      const targets = await response.json();
      target =
        port === rendererPort
          ? targets.find(
              (item) => item.type === "page" && item.url.startsWith("file:"),
            )
          : targets[0];
    }
    if (target) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  if (!target) throw new Error(`Electron did not start: ${output}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => {
    socket.onopen = done;
    socket.onerror = reject;
  });
  sockets.push(socket);
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data),
      request = pending.get(message.id);
    if (
      message.method === "Log.entryAdded" ||
      message.method === "Runtime.exceptionThrown"
    )
      output += JSON.stringify(message) + "\n";
    if (
      message.method === "Runtime.consoleAPICalled" &&
      message.params.args[0]?.value === "desktop-smoke"
    )
      output += `Desktop action: ${message.params.args[1]?.value}\n`;
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  socket.onclose = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error("Electron debugger disconnected."));
    }
    pending.clear();
  };
  function call(method, params) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            `Electron timed out: ${method} (${params?.expression?.slice(0, 160) ?? ""})`,
          ),
        );
      }, 60000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  if (port === rendererPort) {
    await call("Log.enable", {});
    await call("Runtime.enable", {});
  }
  return async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
}

try {
  const main = await connect(mainPort),
    renderer = await connect(rendererPort);
  inspectMain = main;
  // Wait for the actual workbench navigation before running a long evaluation.
  // The initial about:blank context can disappear while Windows is loading it.
  for (let attempt = 0; ; attempt++) {
    if (await renderer("!!window.showai && document.readyState === 'complete'"))
      break;
    if (attempt === 100)
      throw new Error("Desktop workbench did not finish loading.");
    await new Promise((done) => setTimeout(done, 100));
  }
  const native =
    "process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')";
  const result = await renderer(`(async()=>{
    for(let i=0;i<100&&!window.showai;i++) await new Promise(resolve=>setTimeout(resolve,20));
    if(!window.showai) throw new Error('Desktop preload is missing.');
    const api={invoke:(action,...args)=>{console.info('desktop-smoke',action);return window.showai.invoke(action,...args);}};
    const info=await api.invoke('app:info');
    const project=await api.invoke('projects:create',{name:'Desktop smoke'});
    const page=await api.invoke('pages:create',{projectId:project.id,title:'Page'});
    let saved=await api.invoke('pages:save',{projectId:project.id,pageId:page.document.id,baseHash:page.hash,baseRevision:page.revision,document:{...page.document,title:'Saved'}});
    let conflict;
    try {await api.invoke('pages:save',{projectId:project.id,pageId:page.document.id,baseHash:page.hash,baseRevision:page.revision,document:page.document});}catch(error){conflict=error;}
    const duplicate=await api.invoke('pages:duplicate',{projectId:project.id,pageId:page.document.id});
    await api.invoke('pages:remove',{projectId:project.id,pageId:duplicate.document.id});
    await api.invoke('projects:pin',{projectId:project.id,pinned:true});
    const folder=await api.invoke('folders:create',{projectId:project.id,name:'Folder'});
    await api.invoke('folders:rename',{projectId:project.id,folderId:folder.id,name:'Renamed folder'});
    await api.invoke('folders:pin',{projectId:project.id,folderId:folder.id,pinned:true});
    const childFolder=await api.invoke('folders:create',{projectId:project.id,parentId:folder.id,name:'Nested'});
    saved=await api.invoke('pages:move',{projectId:project.id,pageId:saved.document.id,parentId:childFolder.id,baseHash:saved.hash,baseRevision:saved.revision});
    const nestedCopy=await api.invoke('pages:duplicate',{projectId:project.id,pageId:saved.document.id});
    if(nestedCopy.document.parentId!==childFolder.id)throw new Error('Duplicate lost its folder');
    await api.invoke('pages:remove',{projectId:project.id,pageId:nestedCopy.document.id});
    const foreignArtifact={format:'showai',version:saved.document.content.attrs?.kind?3:saved.document.content.type==='surface'?2:1,document:{...saved.document,parentId:'foreign-folder'}};
    const importedNested=await api.invoke('pages:import',{projectId:project.id,parentId:childFolder.id,artifact:foreignArtifact});
    if(importedNested.document.parentId!==childFolder.id)throw new Error('Import ignored its destination folder');
    await api.invoke('pages:remove',{projectId:project.id,pageId:importedNested.document.id});
    const importedRoot=await api.invoke('pages:import',{projectId:project.id,artifact:foreignArtifact});
    if(importedRoot.document.parentId!==null)throw new Error('Import retained a foreign project folder');
    await api.invoke('pages:remove',{projectId:project.id,pageId:importedRoot.document.id});
    const localArtifact={format:'showai',version:saved.document.content.attrs?.kind?3:saved.document.content.type==='surface'?2:1,document:saved.document};
    const importedLocal=await api.invoke('pages:import',{projectId:project.id,artifact:localArtifact});
    if(importedLocal.document.parentId!==childFolder.id)throw new Error('Legacy import lost a valid local folder');
    await api.invoke('pages:remove',{projectId:project.id,pageId:importedLocal.document.id});
    const importedExplicitRoot=await api.invoke('pages:import',{projectId:project.id,parentId:null,artifact:localArtifact});
    if(importedExplicitRoot.document.parentId!==null)throw new Error('Explicit root import was ignored');
    await api.invoke('pages:remove',{projectId:project.id,pageId:importedExplicitRoot.document.id});
    saved=await api.invoke('pages:rename',{projectId:project.id,pageId:saved.document.id,title:'Renamed',baseHash:saved.hash,baseRevision:saved.revision});
    saved=await api.invoke('pages:pin',{projectId:project.id,pageId:saved.document.id,pinned:true,baseHash:saved.hash,baseRevision:saved.revision});
    const templatePage=await api.invoke('pages:create',{projectId:project.id,parentId:childFolder.id,templateId:'research',title:'Folder template'});
    const organized=await api.invoke('pages:list',{projectId:project.id});
    await api.invoke('folders:remove',{projectId:project.id,folderId:folder.id});
    const hiddenPages=await api.invoke('pages:list',{projectId:project.id});
    const hiddenFolders=await api.invoke('folders:list',{projectId:project.id});
    saved=await api.invoke('pages:move',{projectId:project.id,pageId:saved.document.id,parentId:null,baseHash:saved.hash,baseRevision:saved.revision});
    saved=await api.invoke('pages:rename',{projectId:project.id,pageId:saved.document.id,title:'Saved',baseHash:saved.hash,baseRevision:saved.revision});
    const disposable=await api.invoke('projects:create',{name:'Removed project'});
    await api.invoke('projects:remove',{projectId:disposable.id});
    const projects=await api.invoke('projects:list');
    const organization={folderPage:templatePage.document.parentId===childFolder.id,pinnedPage:organized[0].id===saved.document.id&&organized[0].favorite,folderSubtreeHidden:!hiddenPages.length&&!hiddenFolders.length,projectPinned:projects[0].id===project.id&&projects[0].pinned,projectRemoved:!projects.some(item=>item.id===disposable.id)};
    const pages=await api.invoke('pages:list',{projectId:project.id});
    const templates=await api.invoke('templates:list',{projectId:project.id});
    const component=await api.invoke('components:createExample',{projectId:project.id});
    const source=await api.invoke('components:source',{projectId:project.id,id:component.id,version:component.version});
    const asset='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
    const nextComponent=await api.invoke('components:save',{projectId:project.id,manifest:{...source.manifest,version:'1.0.1'},schema:source.schema,source:source.source,files:source.files,assets:{'pixel.png':asset}});
    const nextSource=await api.invoke('components:source',{projectId:project.id,id:nextComponent.id,version:nextComponent.version});
    const savedCustom=await api.invoke('pages:save',{projectId:project.id,pageId:saved.document.id,baseHash:saved.hash,baseRevision:saved.revision,document:{...saved.document,content:{...saved.document.content,content:[...saved.document.content.content,{type:'widget',attrs:{kind:'custom',data:{componentId:nextComponent.id,version:nextComponent.version,integrity:nextComponent.integrity,props:nextComponent.defaultData}}}]}}});
    const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.style.width='500px';
    const frameReady=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Component did not run under the desktop CSP.')),10000);window.addEventListener('message',function receive(event){if(event.source!==frame.contentWindow||event.data?.channel!=='desktop-smoke')return;if(event.data.type==='showai:error'){clearTimeout(timeout);window.removeEventListener('message',receive);reject(new Error(event.data.message));}else if(event.data.type==='showai:ready'){frame.contentWindow.postMessage({channel:'desktop-smoke',type:'showai:validate',requestId:'check',props:component.defaultData},'*');}else if(event.data.type==='showai:validation'&&event.data.requestId==='check'&&event.data.valid){clearTimeout(timeout);window.removeEventListener('message',receive);resolve(true);}})});
    frame.srcdoc=component.html.replace('<!--SHOWAI_COMPONENT_DATA-->','<script id="showai-component-data" type="application/json">'+JSON.stringify({channel:'desktop-smoke',props:component.defaultData,readOnly:false})+'</script>');document.body.append(frame);
    const componentReady=await frameReady;frame.remove();
    const search=await api.invoke('library:search',{projectId:project.id,query:'Saved'});
    const csp=document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content;
    const unknown=await api.invoke('arbitrary:read',{}).catch(error=>error.code);
    return {search,revision:savedCustom.revision,home:info.home,packaged:info.packaged,projectId:project.id,pageId:savedCustom.document.id,cli:info.cli,pageCount:pages.length,title:pages[0].title,conflict,organization,templateCount:templates.length,componentBytes:component.html.length,componentSource:source.source.length,componentsOnSave:Array.isArray(saved.components),assetsPreserved:nextSource.assets?.['pixel.png']===asset,componentReady,csp,unknown};
  })()`);
  assert.equal(result.home, join(temporary, "home"));
  assert.equal(result.packaged, Boolean(packagedExecutable));
  assert.equal(result.pageCount, 1);
  assert.match(result.revision, /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
  assert.ok(
    result.search.items.some((item) => item.resourceId === result.pageId),
  );
  assert.equal(result.title, "Saved");
  assert.ok(
    Object.values(result.organization).every(Boolean),
    JSON.stringify(result.organization),
  );
  assert.equal(result.conflict.code, "CONFLICT");
  assert.match(result.conflict.currentHash, /^[a-f0-9]{64}$/);
  assert.equal(result.unknown, "INVALID_DATA");
  assert.equal(result.componentsOnSave, true);
  assert.equal(result.assetsPreserved, true);
  assert.equal(result.componentReady, true);
  assert.ok(result.csp?.includes("connect-src https: http:"));
  const scriptSources = result.csp
    .split(";")
    .find((directive) => directive.trim().startsWith("script-src "))
    ?.trim()
    .split(/\s+/);
  assert.ok(scriptSources?.includes("'wasm-unsafe-eval'"));
  assert.ok(!scriptSources.includes("'unsafe-eval'"));
  assert.ok(
    result.templateCount > 0 &&
      result.componentBytes > 0 &&
      result.componentSource > 0,
  );
  const cli = await promisify(execFile)(
    result.cli.command,
    [...result.cli.args, "projects", "list", "--json"],
    {
      env: { ...environment, ...result.cli.env },
      timeout: 15000,
    },
  );
  assert.equal(JSON.parse(cli.stdout).ok, true);
  const verified = await promisify(execFile)(
    result.cli.command,
    [...result.cli.args, "library", "verify", "--json"],
    {
      cwd: temporary,
      env: { ...environment, ...result.cli.env },
      timeout: 20000,
    },
  );
  assert.equal(JSON.parse(verified.stdout).data.verified, true);
  await renderer(
    "window.__closeCount=0;window.__release=window.showai.onBeforeClose(async()=>{window.__closeCount++;return false});'registered'",
  );
  await main(`${native}.BrowserWindow.getAllWindows()[0].close(); 'requested'`);
  await new Promise((done) => setTimeout(done, 300));
  const refusal = await renderer(
    "({count:window.__closeCount,bridge:!!window.showai})",
  );
  assert.deepEqual(refusal, { count: 1, bridge: true });
  await main(`${native}.app.quit(); 'quit requested'`);
  await new Promise((done) => setTimeout(done, 300));
  assert.deepEqual(
    await renderer("({count:window.__closeCount,bridge:!!window.showai})"),
    { count: 2, bridge: true },
  );
  await renderer("window.__release();'released'");
  // Reply before closing the last window. Windows quits the event loop at that
  // point, so another inspector evaluation can wait forever for a response.
  await main(
    `setTimeout(()=>{const window=${native}.BrowserWindow.getAllWindows()[0];window.once('closed',()=>${native}.app.quit());window.close();},50); 'requested'`,
  );
  const exited = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(new Error("Desktop did not quit after its last window closed.")),
      15000,
    );
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  for (const socket of sockets) socket.close();
  await exited;
  assert.ok(
    child.exitCode !== null || child.signalCode !== null,
    "Desktop application must exit before testing the independent CLI.",
  );
  const exported = await promisify(execFile)(
    result.cli.command,
    [
      ...result.cli.args,
      "export",
      "--project",
      result.projectId,
      "--page",
      result.pageId,
      "--format",
      "html",
      "--out",
      join(temporary, "portable.html"),
      "--json",
    ],
    {
      cwd: temporary,
      env: { ...environment, ...result.cli.env },
      timeout: 20000,
    },
  );
  const artifact = JSON.parse(exported.stdout);
  assert.equal(artifact.ok, true);
  const html = await readFile(artifact.data.path, "utf8");
  assert.ok(html.includes("showai-data") && html.includes("componentId"));
  console.log(
    JSON.stringify(
      {
        passed: true,
        packaged: result.packaged,
        checks: [
          "desktop bridge",
          "file persistence",
          "versioned history, original page and human attribution",
          "search from committed content",
          "Library integrity using bundled runtime",
          "nested folders, rename, pin, move, and soft removal",
          "duplicate/import destination and legacy folder compatibility",
          "conflict details",
          "soft removal",
          "catalog",
          "React compiler",
          "component binary assets survive source saves",
          "sandboxed React under desktop CSP",
          "action allowlist",
          "native close cancellation",
          "app quit cancellation",
          "CLI using bundled Electron runtime",
          "native close after flush",
          "standalone custom HTML export with desktop process stopped",
        ],
        componentBytes: result.componentBytes,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error);
  if (inspectMain)
    console.error(
      await inspectMain(
        "Promise.all(process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').BrowserWindow.getAllWindows().flatMap(window=>window.webContents.mainFrame.frames).map(async frame=>({url:frame.url,content:await frame.executeJavaScript('({text:document.body?.innerText, scripts:document.scripts.length,config:document.getElementById(\"showai-component-data\")?.textContent})')})))",
      ).catch((reason) => String(reason)),
    );
  console.error(output);
  process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.close();
  await stopTestProcess(child);
  await rm(temporary, { recursive: true, force: true });
}
