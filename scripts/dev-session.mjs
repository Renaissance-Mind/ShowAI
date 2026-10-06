import { randomUUID } from "node:crypto";

/** Ask each open workbench to flush before replacing its local backend. */
export function developmentSessions(ws, timeout = 20000) {
  const clients = new Set();
  let pending;
  ws.on("showai:hello", (_data, client) => {
    if (clients.has(client)) return;
    clients.add(client);
    client.socket.once("close", () => {
      clients.delete(client);
      // A disappearing window is not proof that its draft was saved.
      if (pending?.waiting.has(client)) pending.finish(false);
    });
    if (pending) {
      pending.waiting.add(client);
      client.send("showai:prepare-restart", { id: pending.id });
    }
  });
  ws.on("showai:restart-result", (data, client) => {
    if (!pending || data?.id !== pending.id || !pending.waiting.has(client))
      return;
    if (data.allow !== true) return pending.finish(false);
    pending.waiting.delete(client);
    if (!pending.waiting.size) pending.finish(true);
  });
  return {
    async prepare() {
      if (pending) throw new Error("A development restart is already pending.");
      if (!clients.size) return true;
      return new Promise((resolve) => {
        const timer = setTimeout(() => pending?.finish(false), timeout);
        pending = {
          id: randomUUID(),
          waiting: new Set(clients),
          finish(allow) {
            clearTimeout(timer);
            pending = undefined;
            if (!allow) ws.send("showai:restart-cancelled", {});
            resolve(allow);
          },
        };
        ws.send("showai:prepare-restart", { id: pending.id });
      });
    },
  };
}
