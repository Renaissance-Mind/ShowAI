import type { JsonSchema } from "../components/custom/types";
const appearanceLabels: Record<string, string> = {
  fontFamily: "字体",
  fontSize: "字号",
  color: "文字颜色",
  backgroundColor: "背景颜色",
  align: "对齐",
  padding: "内边距",
  radius: "圆角",
  width: "宽度",
  height: "高度",
  fit: "裁切方式",
};
export default function ComponentAdjustmentSummary({
  schema,
}: {
  schema: JsonSchema;
}) {
  const properties =
    typeof schema === "object" &&
    schema.properties &&
    typeof schema.properties === "object"
      ? (schema.properties as Record<string, unknown>)
      : {};
  const appearance = Object.keys(properties)
    .filter((key) => appearanceLabels[key])
    .map((key) => appearanceLabels[key]);
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
      {appearance.length > 0 && <p>{appearance.join("、")}</p>}
      {content.length > 0 && <p>{content.join("、")}</p>}
    </div>
  );
}
