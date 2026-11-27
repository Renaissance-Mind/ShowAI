import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer, request } from "node:http";
import { dirname } from "node:path";

function socketPath(id: string) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))
    throw new Error("Invalid ShowAI desktop channel.");
  const name = "showai-page-" + id;
  return process.platform === "win32" ? "\\\\.\\pipe\\" + name : "/tmp/" + name + "/open.sock";
}

export async function listenForDesktopPages(open: (home: string, url: string) => Promise<boolean>) {
  const id = randomUUID();
  const path = socketPath(id);
  const directory = process.platform === "win32" ? undefined : dirname(path);
  if (directory) await mkdir(directory, { mode: 0o700 });
  const cleanup = () => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  };
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/open") {
      res.writeHead(404).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const part of req) {
        size += part.length;
        if (size > 16384) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(part);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (typeof input?.home !== "string" || typeof input.url !== "string") {
        res.writeHead(400).end();
        return;
      }
      res.writeHead(await open(input.home, input.url) ? 204 : 409).end();
    } catch (error) {
      res.writeHead(error instanceof SyntaxError || error instanceof TypeError ? 400 : 500).end();
    }
  });
  process.once("exit", cleanup);
  server.once("close", () => {
    process.off("exit", cleanup);
    cleanup();
  });
  server.listen(path);
  try {
    await once(server, "listening");
  } catch (error) {
    server.close();
    throw error;
  }
  server.unref();
  return { id, close: () => server.close() };
}

export function sendToRunningDesktop(id: string, home: string, url: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const call = request({ socketPath: socketPath(id), path: "/open", method: "POST", agent: false }, (response) => {
      response.resume();
      if (response.statusCode === 204) resolve(true);
      else if (response.statusCode === 409) resolve(false);
      else reject(new Error("The running ShowAI app could not open this page (" + response.statusCode + ")."));
    });
    call.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
    call.setTimeout(15000, () => call.destroy(new Error("The running ShowAI app did not answer.")));
    call.end(JSON.stringify({ home, url }));
  });
}
