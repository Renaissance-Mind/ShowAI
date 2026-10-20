import { useEffect, useState } from "react";
import type { SampleState } from "../core/onboarding";
import type { AgentConnectionRecord } from "../agent/mcp-connections";
import { getLocale, translator, type Locale } from "../i18n";
import messages from "../i18n/messages/onboarding";
import { desktop, errorCode, errorMessage } from "./bridge";

export const SAMPLE_KEYS = ["kyoto", "attention", "foldable"] as const;
export type SampleKey = (typeof SAMPLE_KEYS)[number];
export const SAMPLE_ICONS: Record<SampleKey, string> = {
  kyoto: "⛩️",
  attention: "🔦",
  foldable: "📱",
};

// Page sources exported in the `.showai.json` format with their compiled
// component dependencies (resources/samples/sources.json records provenance).
// Each file is its own lazy chunk, loaded only when a new library is set up.
const sources: Record<
  Locale,
  Record<SampleKey, () => Promise<{ default: string }>>
> = {
  "zh-CN": {
    kyoto: () => import("../../resources/samples/zh-CN/kyoto.showai.json?raw"),
    attention: () =>
      import("../../resources/samples/zh-CN/attention.showai.json?raw"),
    foldable: () =>
      import("../../resources/samples/zh-CN/foldable.showai.json?raw"),
  },
  en: {
    kyoto: () => import("../../resources/samples/en/kyoto.showai.json?raw"),
    attention: () =>
      import("../../resources/samples/en/attention.showai.json?raw"),
    foldable: () =>
      import("../../resources/samples/en/foldable.showai.json?raw"),
  },
};

export interface Onboarding {
  samples: SampleState | null;
  connections: AgentConnectionRecord[];
}

/**
 * Reads the library's first-run state and creates its sample project once.
 * Only libraries the App itself created are `pending`; others stay untouched.
 */
export function useSampleProject(
  home: string | null,
  onCreated: () => Promise<unknown>,
  onError: (error: unknown) => void,
) {
  const [samples, setSamples] = useState<SampleState | null>(null);
  const [preparing, setPreparing] = useState(false);
  useEffect(() => {
    setSamples(null);
    if (!home) return;
    let stopped = false;
    void (async () => {
      const current = await desktop
        .invoke<Onboarding>("agent:onboarding")
        .catch((reason) => {
          // Hosts without the App's library runtime, such as the website workbench, have no first-run state.
          if (errorCode(reason) === "UNAVAILABLE") return null;
          throw reason;
        });
      if (stopped || !current) return;
      setSamples(current.samples);
      if (current.samples?.state !== "pending") return;
      setPreparing(true);
      try {
        const locale = getLocale();
        const t = translator(messages);
        const pages = await Promise.all(
          SAMPLE_KEYS.map(async (key) => ({
            key,
            artifact: (await sources[locale][key]()).default,
          })),
        );
        const next = await desktop.invoke<SampleState | null>(
          "agent:seedSamples",
          { name: t("samples.project"), icon: "🧩", locale, pages },
        );
        if (stopped) return;
        setSamples(next);
        if (next?.state === "seeded") await onCreated();
        if (next?.state === "failed")
          onError(new Error(t("samples.failed", { error: next.error })));
      } finally {
        if (!stopped) setPreparing(false);
      }
    })().catch((reason) => {
      if (!stopped) onError(new Error(errorMessage(reason)));
    });
    return () => {
      stopped = true;
    };
  }, [home]);
  return { samples, preparing };
}
