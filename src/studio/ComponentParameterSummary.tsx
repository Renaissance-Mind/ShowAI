import type { ComponentDocumentation } from "../components/custom/documentation";
import type { JsonSchema } from "../components/custom/types";
import { translator, type MessageKey } from "../i18n";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/catalog";

const t = translator(messages);
// Catalog-namespace keys, translated when the summary renders.
const typeNames: Record<string, MessageKey<typeof messages>> = {
  string: "type.string",
  number: "type.number",
  integer: "type.integer",
  boolean: "type.boolean",
  array: "type.array",
  object: "type.object",
  null: "type.null",
};
const typeName = (type: string) =>
  Object.hasOwn(typeNames, type) ? t(typeNames[type]) : type;

function parameterType(field: Record<string, unknown>): string {
  if (Array.isArray(field.type))
    return field.type.map((type) => typeName(String(type))).join(" / ");
  if (typeof field.type === "string") return typeName(field.type);
  const variants = field.anyOf ?? field.oneOf;
  if (Array.isArray(variants))
    return [...new Set(variants.map((rule) => parameterType(rule)))].join(
      " / ",
    );
  if (Array.isArray(field.enum)) return t("type.enum");
  if (Object.hasOwn(field, "const")) return t("type.const");
  return "—";
}

function displayDefault(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return t("type.null");
  if (Array.isArray(value)) return t("default.list", { count: value.length });
  if (typeof value === "object")
    return t("default.object", { count: Object.keys(value).length });
  if (typeof value === "boolean")
    return t(value ? "default.on" : "default.off");
  return String(value);
}

export default function ComponentParameterSummary({
  schema,
  defaults,
  documentation,
}: {
  schema: JsonSchema;
  defaults: Record<string, unknown>;
  documentation?: ComponentDocumentation;
}) {
  // Re-render when the language changes; helpers above call t() lazily.
  const tr = useTranslator(messages);
  const properties =
    typeof schema === "object" &&
    schema.properties &&
    typeof schema.properties === "object"
      ? (schema.properties as Record<string, Record<string, unknown> | boolean>)
      : {};
  const required =
    typeof schema === "object" && Array.isArray(schema.required)
      ? schema.required
      : [];
  const names = [
    ...new Set([
      ...Object.keys(properties),
      ...(documentation?.usage.inputs.map((input) => input.path) ?? []),
    ]),
  ];
  return (
    <section className="catalog-parameter-summary">
      <h3>{tr("inputsAndParameters")}</h3>
      {names.length ? (
        <div className="catalog-parameter-table">
          <table>
            <thead>
              <tr>
                <th>{tr("column.parameter")}</th>
                <th>{tr("column.purpose")}</th>
                <th>{tr("column.type")}</th>
                <th>{tr("column.default")}</th>
              </tr>
            </thead>
            <tbody>
              {names.map((name) => {
                const rule = properties[name];
                const field = typeof rule === "object" ? rule : {};
                const meaning =
                  documentation?.usage.inputs.find(
                    (input) => input.path === name,
                  )?.meaning ??
                  field.description ??
                  field.title;
                const value = Object.hasOwn(defaults, name)
                  ? defaults[name]
                  : field.default;
                const preview = displayDefault(value);
                const raw = value === undefined ? "" : JSON.stringify(value);
                return (
                  <tr key={name}>
                    <th>
                      <code>{name}</code>
                      {required.includes(name) && (
                        <small>{tr("required")}</small>
                      )}
                    </th>
                    <td>
                      {typeof meaning === "string"
                        ? meaning
                        : tr("seeUsageAndExamples")}
                    </td>
                    <td>{parameterType(field)}</td>
                    <td title={raw}>
                      {preview && preview.length > 100
                        ? preview.slice(0, 100) + "…"
                        : preview}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p>{tr("noTopLevelParameters")}</p>
      )}
    </section>
  );
}
