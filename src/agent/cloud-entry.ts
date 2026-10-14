import { startMcpHttpServer } from "./mcp-http";
import { CloudState, httpObjectStore } from "./cloud-state";
import { checkCloudBrowser } from "./cloud-browser-check";
const publicUrl = process.env.SHOWAI_MCP_URL;
const stateKey = process.env.SHOWAI_MCP_STATE_KEY;
const syncServer = process.env.SHOWAI_MCP_SYNC_SERVER;
if (!publicUrl || !stateKey || !syncServer)
  throw new Error("MCP URL, sync server and state key are required.");
const stateDirectory = "/state";
// A deployment is ready only after Chromium renders on the actual cloud CPU.
const browserRendering = await checkCloudBrowser();
const gateway = await startMcpHttpServer({
  host: "0.0.0.0",
  port: 8789,
  publicUrl,
  stateDirectory,
  syncServers: [syncServer],
  browserRendering,
  durableState: new CloudState(
    stateDirectory,
    httpObjectStore(publicUrl, stateKey),
    stateKey,
  ),
});
// As PID 1 the process ignores SIGTERM without a handler, so rollouts would
// wait for SIGKILL. Stop accepting requests and exit once in-flight requests,
// whose responses follow their state checkpoint, have finished.
process.once("SIGTERM", () => {
  gateway.server.close(() => process.exit(0));
  gateway.server.closeIdleConnections();
});
console.log("ShowAI Cloud MCP is ready.");
