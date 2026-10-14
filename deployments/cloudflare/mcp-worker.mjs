import { DurableObject } from "cloudflare:workers";
import { stateRequest } from "./mcp-state-broker.mjs";

export class ShowAIMcpGateway extends DurableObject {
  tail = Promise.resolve();
  constructor(ctx, env) {
    super(ctx, env);
    if (ctx.container?.running)
      ctx.blockConcurrencyWhile(() =>
        ctx.container.setInactivityTimeout(600000),
      );
  }
  async fetch(request) {
    if (new URL(request.url).pathname.startsWith("/__state/"))
      return stateRequest(request, this.env);
    const next = this.tail.then(async () => {
      const container = this.ctx.container;
      if (!container) throw new Error("MCP container binding is missing.");
      if (!container.running) {
        try {
          container.start({
            enableInternet: true,
            env: {
              SHOWAI_MCP_URL: this.env.SHOWAI_MCP_URL,
              SHOWAI_MCP_SYNC_SERVER: this.env.SHOWAI_MCP_SYNC_SERVER,
              SHOWAI_MCP_STATE_KEY: this.env.SHOWAI_MCP_STATE_KEY,
            },
          });
          await container.setInactivityTimeout(600000);
        } catch (error) {
          // Right after a deployment Cloudflare may still be provisioning the
          // Container; answer with a retryable status instead of an exception.
          console.error("MCP container start failed:", error);
          return new Response("ShowAI MCP is starting. Retry shortly.", {
            status: 503,
            headers: { "retry-after": "10" },
          });
        }
      }
      const port = container.getTcpPort(8789);
      // Probe only the read-only health endpoint; never replay an operation.
      const deadline = Date.now() + 45000;
      let ready = false;
      while (Date.now() < deadline) {
        try {
          const probeUrl = new URL("/health", this.env.SHOWAI_MCP_URL);
          probeUrl.protocol = "http:";
          const probe = await port.fetch(probeUrl);
          await probe.arrayBuffer();
          if (probe.ok) {
            ready = true;
            break;
          }
        } catch {
          /* Connection refusal while the container boots. */
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!ready)
        return new Response(
          "ShowAI MCP is starting or could not restore its state. Retry shortly.",
          { status: 503, headers: { "retry-after": "10" } },
        );
      const target = new URL(request.url);
      target.protocol = "http:";
      // The container listens on plain HTTP; preserve the public host and Origin header.
      return port.fetch(new Request(target.href, request));
    });
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
export default {
  async fetch(request, env) {
    if (!/^[a-f0-9]{64}$/.test(env.SHOWAI_MCP_STATE_KEY ?? ""))
      return new Response("MCP state secret is not configured.", {
        status: 503,
      });
    if (new URL(request.url).origin !== env.SHOWAI_MCP_URL)
      return new Response("Unknown MCP origin.", { status: 421 });
    return env.GATEWAY.get(env.GATEWAY.idFromName("showai-mcp-v1")).fetch(
      request,
    );
  },
};
