import { getDocument } from "pdfjs-dist";
import { WorkerMessageHandler } from "pdfjs-dist/build/pdf.worker.min.mjs";
import assets from "./pdf-assets.json";
import { translator } from "../../i18n";
import messages from "../../i18n/messages/pdf";

const t = translator(messages);
// The bundled worker handler runs in-process so standalone HTML needs no worker URL,
// CDN, eval or filesystem access. PDF loading/rendering remains asynchronous.
(globalThis as typeof globalThis & { pdfjsWorker: unknown }).pdfjsWorker = {
  WorkerMessageHandler,
};
export function loadPdf(src: string) {
  const options = {
    isEvalSupported: false,
    useWorkerFetch: false,
    useSystemFonts: true,
    BinaryDataFactory: OfflineBinaryDataFactory,
  };
  if (src.startsWith("data:")) {
    const binary = atob(src.slice(src.indexOf(",") + 1));
    return getDocument({
      ...options,
      data: Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    });
  }
  // A linked local file comes from the host's media address, which pdf.js
  // would not fetch itself (it streams only http and https).
  if (!/^https?:$/i.test(new URL(src, location.href).protocol)) {
    let task: ReturnType<typeof getDocument> | undefined;
    let destroyed = false;
    return {
      promise: fetch(src).then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = new Uint8Array(await response.arrayBuffer());
        if (destroyed) throw new Error("PDF loading was cancelled.");
        task = getDocument({ ...options, data });
        return task.promise;
      }),
      destroy: async () => {
        destroyed = true;
        await task?.destroy();
      },
    };
  }
  return getDocument({ ...options, url: src, withCredentials: false });
}
class OfflineBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const encoded = (assets as Record<string, Record<string, string>>)[kind]?.[
      filename
    ];
    if (!encoded)
      throw new Error(t("missingAsset", { path: `${kind}/${filename}` }));
    const binary = atob(encoded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
}
