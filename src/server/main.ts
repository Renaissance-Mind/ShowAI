import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startSyncServer } from "./node";
import { syncProtocol } from "../sync/protocol";
import type { ServerOptions } from "./app";
import { configuredLogins } from "./external-logins";
export * from "./node";

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const running = await startSyncServer({
    ...configuredLogins(process.env),
    home: process.env.SHOWAI_SERVER_HOME ?? "./showai-server-data",
    host: process.env.SHOWAI_SERVER_HOST ?? "127.0.0.1",
    port: Number(process.env.SHOWAI_SERVER_PORT ?? 8788),
    name: process.env.SHOWAI_SERVER_NAME,
    vaultKey: process.env.SHOWAI_VAULT_KEY,
    publicUrl: process.env.SHOWAI_SERVER_URL,
    registrationKey: process.env.SHOWAI_REGISTRATION_KEY,
    registrationMode: process.env
      .SHOWAI_REGISTRATION_MODE as ServerOptions["registrationMode"],
    registrationLimit: process.env.SHOWAI_REGISTRATION_LIMIT
      ? Number(process.env.SHOWAI_REGISTRATION_LIMIT)
      : undefined,
    accountLimit: process.env.SHOWAI_ACCOUNT_LIMIT
      ? Number(process.env.SHOWAI_ACCOUNT_LIMIT)
      : undefined,
    storagePolicy: process.env.SHOWAI_STORAGE_POLICY
      ? JSON.parse(process.env.SHOWAI_STORAGE_POLICY)
      : undefined,
    requestPolicy: process.env.SHOWAI_REQUEST_POLICY
      ? JSON.parse(process.env.SHOWAI_REQUEST_POLICY)
      : undefined,
    allowedOrigins:
      process.env.SHOWAI_ALLOWED_ORIGINS?.split(",").filter(Boolean),
    operationsKey: process.env.SHOWAI_OPERATIONS_KEY,
  });
  console.log(
    JSON.stringify({
      protocol: syncProtocol,
      url: running.url,
      home: resolve(process.env.SHOWAI_SERVER_HOME ?? "./showai-server-data"),
    }),
  );
  const shutdown = () => {
    void running.close().then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
