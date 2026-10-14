import type { JsonSchema } from "../components/custom/types";
import type { MessageKey } from "../i18n";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/catalog";
// Catalog-namespace keys, translated at render.
const appearanceLabels: Record<string, MessageKey<typeof messages>> = {
  fontFamily: "appearance.fontFamily",
  fontSize: "appearance.fontSize",
  color: "appearance.color",
  backgroundColor: "appearance.backgroundColor",
  align: "appearance.align",
  padding: "appearance.padding",
  radius: "appearance.radius",
  width: "appearance.width",
  height: "appearance.height",
  fit: "appearance.fit",
};
export default function ComponentAdjustmentSummary({
  schema,
}: {
  schema: JsonSchema;
}) {
  const t = useTranslator(messages);
  const properties =
    typeof schema === "object" &&
    schema.properties &&
    typeof schema.properties === "object"
      ? (schema.properties as Record<string, unknown>)
      : {};
  const appearance = Object.keys(properties)
    .filter((key) => appearanceLabels[key])
    .map((key) => t(appearanceLabels[key]));
  const content = Object.entries(properties)
    .filter(([key]) => !appearanceLabels[key])
    .slice(0, 5)
    .map(([key, value]) =>
      value &&
      typeof value === "object" &&
      typeof (value as Record<string, unknown>).title === "string"
        ? String((value as Record<string, unknown>).title)
        : key,
    );
  return (
    <div className="catalog-adjustments">
      {appearance.length > 0 && <p>{appearance.join(t("listSeparator"))}</p>}
      {content.length > 0 && <p>{content.join(t("listSeparator"))}</p>}
    </div>
  );
}
