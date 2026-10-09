import {
  eventProtocol,
  maximumEventBytes,
  maximumEventProjects,
  type ProjectEvent,
} from "./events";

/** Reconnects with a complete subscription; a missed frame never substitutes
 * for verified project history. The socket carries no draft or write command. */
export class ProjectEventStream {
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private handshake?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private attempts = 0;
  private lastMessage = 0;
  private pending = Promise.resolve();
  private pendingBytes = 0;
  private ids: string[] = [];
  ready = false;
  constructor(
    readonly url: string,
    readonly token: string,
    readonly receive: (event: ProjectEvent) => Promise<void>,
    readonly unavailable: () => void,
  ) {}
  subscribe(ids: string[]) {
    const selected = [...new Set(ids)].sort().slice(0, maximumEventProjects);
    if (JSON.stringify(selected) === JSON.stringify(this.ids)) return;
    this.ids = selected;
    if (this.socket?.readyState === WebSocket.OPEN) this.sendSubscription();
  }
  covers(id: string) {
    return this.ids.includes(id);
  }
  private sendSubscription() {
    this.socket!.send(JSON.stringify({ type: "subscribe", ids: this.ids }));
  }
  start() {
    if (this.stopped || this.socket) return;
    const endpoint = new URL(`${this.url}/api/events`);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(endpoint, [
      eventProtocol,
      `token-${this.token}`,
    ]);
    this.socket = socket;
    this.handshake = setTimeout(() => socket.close(), 10_000);
    this.handshake.unref();
    socket.addEventListener("open", () => {
      if (this.handshake) clearTimeout(this.handshake);
      this.handshake = undefined;
      if (this.stopped) {
        socket.close();
        return;
      }
      this.lastMessage = Date.now();
      this.attempts = 0;
      this.sendSubscription();
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastMessage > 60_000) {
          socket.close();
          return;
        }
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ type: "ping" }));
      }, 25_000);
      this.heartbeat.unref();
    });
    socket.addEventListener("message", (message) => {
      this.lastMessage = Date.now();
      const size =
        typeof message.data === "string"
          ? new TextEncoder().encode(message.data).length
          : maximumEventBytes + 1;
      if (
        size > maximumEventBytes ||
        this.pendingBytes + size > 4 * maximumEventBytes
      ) {
        this.ready = false;
        this.unavailable();
        socket.close();
        return;
      }
      this.pendingBytes += size;
      this.pending = this.pending
        .then(async () => {
          if (this.stopped || this.socket !== socket) return;
          if (
            typeof message.data !== "string" ||
            new TextEncoder().encode(message.data).length > maximumEventBytes
          )
            throw new Error("Invalid project event frame.");
          const event = JSON.parse(message.data) as ProjectEvent;
          if (event.type === "pong") return;
          if (event.type === "error") {
            if (
              [
                "UNAUTHORIZED",
                "READ_BUDGET_EXCEEDED",
                "REQUEST_BUDGET_EXCEEDED",
              ].includes(event.code)
            )
              this.stopped = true;
            throw new Error(`Project events: ${event.code}`);
          }
          await this.receive(event);
          if (event.type === "heads") this.ready = true;
        })
        .catch((error) => {
          console.error("Project update stream failed", error);
          this.ready = false;
          this.unavailable();
          socket.close();
        })
        .finally(() => {
          this.pendingBytes -= size;
        });
    });
    socket.addEventListener("error", () => {
      this.ready = false;
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.ready = false;
      if (event.code === 4001) this.stopped = true;
      if (this.handshake) clearTimeout(this.handshake);
      this.handshake = undefined;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = undefined;
      this.unavailable();
      if (!this.stopped) {
        this.timer = setTimeout(
          () => {
            this.timer = undefined;
            this.start();
          },
          Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5)),
        );
        this.timer.unref();
      }
    });
  }
  async stop() {
    this.stopped = true;
    this.ready = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.handshake) clearTimeout(this.handshake);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.socket?.close(1000, "Stopping project updates.");
    await this.pending;
  }
}
