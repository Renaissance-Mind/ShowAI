import type { ComponentDocumentation } from "../components/custom/documentation";
import type { JsonSchema } from "../components/custom/types";
const typeNames: Record<string, string> = {
  string: "文字",
  number: "数值",
  integer: "整数",
  boolean: "开关",
  array: "列表",
  object: "对象",
  null: "空值",
};

function parameterType(field: Record<string, unknown>): string {
  if (Array.isArray(field.type))
    return field.type
      .map((type) => typeNames[String(type)] ?? String(type))
      .join(" / ");
  if (typeof field.type === "string")
    return typeNames[field.type] ?? field.type;
  const variants = field.anyOf ?? field.oneOf;
  if (Array.isArray(variants))
    return [...new Set(variants.map((rule) => parameterType(rule)))].join(
      " / ",
    );
  if (Array.isArray(field.enum)) return "选项";
  if (Object.hasOwn(field, "const")) return "固定值";
  return "—";
}

function displayDefault(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "空值";
  if (Array.isArray(value)) return `列表 · ${value.length} 项`;
  if (typeof value === "object")
    return `对象 · ${Object.keys(value).length} 项`;
  if (typeof value === "boolean") return value ? "开启" : "关闭";
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
      <h3>输入与参数</h3>
      {names.length ? (
        <div className="catalog-parameter-table">
          <table>
            <thead>
              <tr>
                <th>参数</th>
                <th>用途</th>
                <th>类型</th>
                <th>默认值</th>
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
                      {required.includes(name) && <small>必填</small>}
                    </th>
                    <td>
                      {typeof meaning === "string"
                        ? meaning
                        : "查看使用说明与示例"}
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
        <p>此组件没有单独的顶层参数。查看使用说明和示例数据。</p>
      )}
    </section>
  );
}
