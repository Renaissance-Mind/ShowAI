import { SdkInstaller } from "./installer";
const installer = new SdkInstaller(
  process.env.SHOWAI_AGENT_RUNTIME ?? "/runtime",
  {
    cacheRoot: process.env.SHOWAI_AGENT_DOWNLOAD_CACHE,
    version: process.env.SHOWAI_AGENT_SDK_VERSION,
  },
);
installer.start();
await installer.wait();
console.log(
  JSON.stringify({
    runtimeInstalled: true,
    version: (await installer.status()).version,
  }),
);
