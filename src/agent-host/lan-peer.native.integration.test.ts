import { test } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AgentService } from "../agent/service";
import { startSyncServer } from "../server/node";
import { stopSyncManagers } from "../sync/manager";
import { AgentHost } from "./host";
import { LanPeerServer } from "./lan-peer";
test.skipIf(!process.env.SHOWAI_NATIVE_LAN_TEST_ROOT)(
  "serve the real paired Mac for opt-in native acceptance",
  async () => {
    const task = process.env.SHOWAI_NATIVE_LAN_TEST_ROOT!;
    const root = await mkdtemp(join(task, "tmp/native-peer-"));
    const server = await startSyncServer({
      home: join(root, "server"),
      port: 0,
      registrationKey: "native-hybrid-test",
    });
    const account = await fetch(server.url + "/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "native-hybrid-owner",
        password: "native-hybrid-private-passphrase",
        registrationKey: "native-hybrid-test",
        device: "native-hybrid-test",
      }),
    }).then((r) => r.json());
    const service = new AgentService({ root: join(root, "library") });
    const project = await service.createProject("Native LAN acceptance");
    const page = await service.createPage(project.id, {
      title: "Native shared Page",
    });
    const host = new AgentHost({
      root: join(root, "agent"),
      library: () => service.store,
      cli: () => ({ command: process.execPath, args: [], env: {} }),
      pluginRoot: () => join(root, "plugin"),
    });
    const settings = {
      enabled: false,
      nearbyEnabled: true,
      deviceId: randomUUID(),
      name: "ShowAI native LAN test",
      connectionId: "",
      projectIds: [],
      gatewayUrl: "https://example.com",
    };
    const peer = new LanPeerServer(
      host,
      () => service.store.root,
      () => settings,
    );
    await peer.start();
    await writeFile(
      join(task, "tmp/native-peer-fixture.json"),
      JSON.stringify({
        serverURL: server.url,
        token: account.token,
        deviceId: settings.deviceId,
        projectId: project.id,
        pageId: page.document.id,
        metadata: await service.store.readProject(project.id),
        document: page.document,
        commandPath: join(task, "tmp/native-peer-command.json"),
        resultPath: join(task, "tmp/native-peer-result.json"),
      }),
    );
    let busy = false,
      last = "";
    let done!: () => void;
    const finished = new Promise<void>((resolve) => {
      done = resolve;
    });
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        for (const request of peer.status.pending)
          await peer.approve(request.id.slice(4), true);
        const text = await readFile(
          join(task, "tmp/native-peer-command.json"),
          "utf8",
        ).catch((e) => {
          if (e.code === "ENOENT") return "";
          throw e;
        });
        if (text && text !== last) {
          last = text;
          const cmd = JSON.parse(text);
          if (cmd.action === "pause") await peer.close();
          if (cmd.action === "resume") await peer.start();
          const projects = await service.store.listProjects();
          const metadata = await Promise.all(
            projects.map((p) => service.store.readProject(p.id)),
          );
          const target =
            metadata.find(
              (p) =>
                cmd.projectId &&
                p.binding?.harness === "showai-ipad" &&
                p.binding.sessionId.endsWith("/" + cmd.projectId),
            )?.id ?? project.id;
          if (cmd.action === "edit") {
            const current = await service.store.readPage(
              target,
              page.document.id,
            );
            await service.savePage(
              target,
              page.document.id,
              { ...current.document, title: cmd.title },
              current.hash,
              undefined,
              undefined,
              current.revision,
            );
          }
          await writeFile(
            join(task, "tmp/native-peer-result.json"),
            JSON.stringify({
              nonce: cmd.nonce,
              document: (await service.store.readPage(target, page.document.id))
                .document,
              online: peer.status.online,
            }),
          );
          if (cmd.action === "stop") done();
        }
      } catch (error) {
        console.error(error);
      } finally {
        busy = false;
      }
    }, 100);
    console.log("NATIVE_PEER_READY");
    await finished;
    clearInterval(timer);
    await peer.close();
    host.close();
    await stopSyncManagers();
    await server.close();
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  },
  900000,
);
