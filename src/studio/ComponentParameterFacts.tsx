import type { JsonSchema } from "../components/custom/types";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/catalog";
export default function ComponentParameterFacts({
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
  const options = Object.entries(properties).filter(
    ([, value]) =>
      value &&
      typeof value === "object" &&
      Array.isArray((value as Record<string, unknown>).enum),
  );
  const ranges = Object.entries(properties).filter(
    ([, value]) =>
      value &&
      typeof value === "object" &&
      (typeof (value as Record<string, unknown>).minimum === "number" ||
        typeof (value as Record<string, unknown>).maximum === "number"),
  );
  return (
    <>
      {options.length > 0 && (
        <section className="catalog-reference-section">
          <h3>{t("allowedValues")}</h3>
          {options.slice(0, 4).map(([name, field]) => (
            <div className="catalog-parameter-fact" key={name}>
              <code>{name}</code>
              <p>
                {((field as Record<string, unknown>).enum as unknown[])
                  .map(String)
                  .join(" / ")}
              </p>
            </div>
          ))}
        </section>
      )}
      {ranges.length > 0 && (
        <section className="catalog-reference-section">
          <h3>{t("valueRanges")}</h3>
          <dl>
            {ranges.slice(0, 8).map(([name, value]) => {
              const field = value as Record<string, unknown>;
              return (
                <div className="catalog-parameter-fact" key={name}>
                  <dt>
                    <code>{name}</code>
                  </dt>
                  <dd>
                    {String(field.minimum ?? "—")} –{" "}
                    {String(field.maximum ?? "—")}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      )}
    </>
  );
}
