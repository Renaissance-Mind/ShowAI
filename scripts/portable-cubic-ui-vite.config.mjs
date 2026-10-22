// Explicit real acceptance entry; regular production builds never include it.
import config from "../vite.config.ts";
export default {
  ...config,
  build: {
    ...config.build,
    rolldownOptions: {
      input: {
        main: "index.html",
        lifecycle: "scripts/fixtures/portable-cubic-lifecycle.ts",
      },
    },
  },
};
