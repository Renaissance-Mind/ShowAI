import { buildIdentityPlugin } from "./scripts/build-info.mjs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Inline only our own emitted assets; no runtime CDN or pattern-matching dependency. */
function portableHtml(): Plugin {
  return {
    name: "showai-portable-html",
    enforce: "post",
    generateBundle(_options, bundle) {
      const entry = bundle["portable.html"];
      if (!entry || entry.type !== "asset")
        throw new Error("Portable HTML entry was not emitted.");
      let html = String(entry.source);
      html = html.replace(
        /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g,
        (_tag, url: string) => {
          const asset = bundle[url.replace(/^\.\//, "").replace(/^\//, "")];
          if (!asset || asset.type !== "chunk")
            throw new Error(`Missing portable script: ${url}`);
          // Inlined lazy modules may be reported as a reference to this same chunk.
          if (
            asset.imports.length ||
            asset.dynamicImports.some((name) => name !== asset.fileName)
          )
            throw new Error(
              "Portable scripts must be bundled without external imports.",
            );
          return `<script type="module">${asset.code.replace(/<\/script/gi, "<\\/script")}</script>`;
        },
      );
      html = html.replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/g, (tag) => {
        const url = tag.match(/href="([^"]+)"/)?.[1];
        const asset =
          url && bundle[url.replace(/^\.\//, "").replace(/^\//, "")];
        if (!asset || asset.type !== "asset")
          throw new Error(`Missing portable stylesheet: ${url}`);
        return `<style>${String(asset.source).replace(/<\/style/gi, "<\\/style")}</style>`;
      });
      if (/<(?:script|link)\b[^>]*(?:src|href)="(?:\.?\/)?assets\//.test(html))
        throw new Error("Unresolved portable asset reference.");
      entry.source = html;
      for (const name of Object.keys(bundle))
        if (name !== "portable.html") delete bundle[name];
    },
  };
}

export default defineConfig({
  plugins: [react(), buildIdentityPlugin(), portableHtml()],
  base: "./",
  publicDir: false,
  build: {
    outDir: "dist-portable",
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    modulePreload: false,
    rolldownOptions: {
      input: "portable.html",
      output: { codeSplitting: false },
    },
  },
});
