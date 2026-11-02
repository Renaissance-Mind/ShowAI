import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

/** A local HTTP server for online-data tests on 127.0.0.1 and an ephemeral port. */
export async function dataServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
) {
  const requests: { url: string; headers: IncomingMessage["headers"] }[] = [];
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((request, response) => {
    requests.push({ url: request.url ?? "", headers: request.headers });
    handler(request, response);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((done) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => done());
      }),
  };
}
