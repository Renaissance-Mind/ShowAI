import { randomUUID } from "node:crypto";

const text = (value, limit) =>
  typeof value === "string" && value ? value.slice(0, limit) : undefined;

/** Close blockers a workbench window reported, limited to known fields. */
function reportedBlockers(value, url) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((item) => {
    if (!item || typeof item !== "object" || !text(item.code, 60)) return [];
    const blocker = { code: text(item.code, 60) };
    for (const [key, limit] of [
      ["source", 40],
      ["message", 1000],
      ["projectId", 200],
      ["pageId", 200],
      ["datasetId", 200],
      ["title", 200],
    ])
      if (text(item[key], limit)) blocker[key] = text(item[key], limit);
    if (Number.isFinite(item.seconds)) blocker.seconds = item.seconds;
    if (url) blocker.url = url;
    return [blocker];
  });
}

/** One-line text of blockers, for the console and the development badge. */
export function describeBlockers(blockers) {
  return blockers
    .map((blocker) => {
      const subject = blocker.title
        ? `「${blocker.title}」`
        : blocker.pageId ?? blocker.datasetId ?? blocker.source ?? "";
      return `[${blocker.code}] ${subject}${blocker.message ? `：${blocker.message}` : ""}`;
    })
    .join("；");
}

/**
 * Ask each open workbench to flush before replacing its local backend.
 * prepare() resolves { allow, blockers }: a refusal names the window and why.
 */
export function developmentSessions(ws, timeout = 20000) {
  const clients = new Map();
  let pending;
  ws.on("showai:hello", (data, client) => {
    if (clients.has(client)) return;
    clients.set(client, { url: text(data?.url, 2000) });
    client.socket.once("close", () => {
      const url = clients.get(client)?.url;
      clients.delete(client);
      // A disappearing window is not proof that its draft was saved.
      if (pending?.waiting.has(client))
        pending.finish(false, [
          {
            code: "WINDOW_DISCONNECTED",
            source: "window",
            message: "窗口在确认保存之前断开了连接",
            ...(url ? { url } : {}),
          },
        ]);
    });
    if (pending) {
      pending.waiting.add(client);
      client.send("showai:prepare-restart", { id: pending.id });
    }
  });
  ws.on("showai:restart-result", (data, client) => {
    if (!pending || data?.id !== pending.id || !pending.waiting.has(client))
      return;
    if (data.allow !== true) {
      const url = clients.get(client)?.url;
      const blockers = reportedBlockers(data.blockers, url);
      return pending.finish(
        false,
        blockers.length
          ? blockers
          : [
              {
                code: "LISTENER_REFUSED",
                source: "workbench",
                message: "窗口没有确认保存，也没有说明原因",
                ...(url ? { url } : {}),
              },
            ],
      );
    }
    pending.waiting.delete(client);
    if (!pending.waiting.size) pending.finish(true);
  });
  return {
    async prepare() {
      if (pending) throw new Error("A development restart is already pending.");
      if (!clients.size) return { allow: true, blockers: [] };
      return new Promise((resolve) => {
        const timer = setTimeout(
          () =>
            pending?.finish(
              false,
              [...pending.waiting].map((client) => ({
                code: "NO_REPLY",
                source: "window",
                seconds: Math.round(timeout / 1000),
                message: `窗口在 ${Math.round(timeout / 1000)} 秒内没有确认保存`,
                ...(clients.get(client)?.url
                  ? { url: clients.get(client).url }
                  : {}),
              })),
            ),
          timeout,
        );
        pending = {
          id: randomUUID(),
          waiting: new Set(clients.keys()),
          finish(allow, blockers = []) {
            clearTimeout(timer);
            pending = undefined;
            if (!allow)
              ws.send("showai:restart-cancelled", {
                reason: describeBlockers(blockers),
              });
            resolve({ allow, blockers });
          },
        };
        ws.send("showai:prepare-restart", { id: pending.id });
      });
    },
  };
}
