import type { Locale, Message, Namespace } from "../i18n";
import motionMessages from "../i18n/messages/uiMotion";
import type { MotionObservation } from "./types";

export function motionSummary(observation: MotionObservation, locale: Locale) {
  const t = messages(motionMessages, locale);
  const events = observation.events.join(" · ") || t("noEvents");
  return observation.widthChanges === undefined
    ? events
    : events + " · " + t("widthChanges", { count: observation.widthChanges });
}

export function messages<N extends Record<string, Message>>(
  namespace: Namespace<N>,
  locale: Locale,
) {
  return (
    key: keyof N & string,
    params: Record<string, string | number> = {},
  ) => {
    const value = namespace.catalogs[locale][key];
    if (typeof value !== "string")
      throw new Error("UI scene labels must be strings.");
    return value.replace(/\{(\w+)\}/g, (_match, key) =>
      String(params[key] ?? `{${key}}`),
    );
  };
}
