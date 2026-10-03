import type {
  ChartData,
  ChartSeries,
  DatabaseColumn,
  DatabaseRow,
} from "./types";

export const COLORS = [
  "#44745a",
  "#7990b2",
  "#c39659",
  "#a17ea1",
  "#b76e66",
  "#5c9999",
];
export const text = (value: unknown, fallback = "") =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
export const finite = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (/^[\u0000-\u0020]|[\u0000-\u001f]/.test(value)) return undefined;
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol)
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function safeImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (
    /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(value)
  )
    return value;
  return safeUrl(value);
}
export function parseChartData(value: string): {
  labels: string[];
  series: ChartSeries[];
} {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object")
    throw new Error("请填写包含 labels 和 series 的 JSON 对象。");
  const { labels, series } = parsed as Partial<ChartData>;
  if (
    !Array.isArray(labels) ||
    !labels.every((label) => typeof label === "string")
  )
    throw new Error("labels 必须是文字数组。");
  if (!Array.isArray(series)) throw new Error("series 必须是数据系列数组。");
  if (labels.length > 500 || series.length > 20)
    throw new Error("单个图表最多支持 500 个横轴标签、20 个数据系列。");
  for (const item of series) {
    if (!item || typeof item.name !== "string" || !Array.isArray(item.values))
      throw new Error("每个系列需要 name 和 values。");
    if (item.values.length !== labels.length)
      throw new Error(`「${item.name}」的数据数量必须与 labels 一致。`);
    if (
      !item.values.every(
        (value) => typeof value === "number" && Number.isFinite(value),
      )
    )
      throw new Error(`「${item.name}」只能包含有限数字。`);
    if (
      item.color !== undefined &&
      (typeof item.color !== "string" ||
        !/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(item.color))
    )
      throw new Error(
        `「${item.name}」的颜色需要有效的十六进制颜色，例如 #44745a。`,
      );
  }
  return { labels, series };
}

export function filterSortRows(
  rows: DatabaseRow[],
  columns: DatabaseColumn[],
  query: string,
  filter: { column: string; value: string },
  sort: { column: string; direction: "asc" | "desc" } | null,
): DatabaseRow[] {
  const needle = query.trim().toLocaleLowerCase();
  const result = rows.filter(
    (row) =>
      (!needle ||
        columns.some((column) =>
          String(row[column.id] ?? "")
            .toLocaleLowerCase()
            .includes(needle),
        )) &&
      (!filter.column || String(row[filter.column] ?? "") === filter.value),
  );
  if (!sort) return result;
  const column = columns.find((item) => item.id === sort.column);
  return result.sort((a, b) => {
    const aValue = a[sort.column] ?? "",
      bValue = b[sort.column] ?? "";
    const comparison =
      column?.type === "number"
        ? Number(aValue) - Number(bValue)
        : column?.type === "checkbox"
          ? Number(Boolean(aValue)) - Number(Boolean(bValue))
          : String(aValue).localeCompare(String(bValue), "zh-CN", {
              numeric: true,
            });
    return sort.direction === "asc" ? comparison : -comparison;
  });
}

export function toCsv(columns: DatabaseColumn[], rows: DatabaseRow[]): string {
  const escape = (value: unknown) => {
    const content = String(value ?? "");
    // Preserve text when opened in spreadsheet software instead of evaluating formulas.
    const safe =
      /^[\s]*[=+@-]|^[\t\r\n]/.test(content) && !/^-?\d+(\.\d+)?$/.test(content)
        ? `'${content}`
        : content;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" +
    [
      columns.map((column) => escape(column.name)).join(","),
      ...rows.map((row) =>
        columns.map((column) => escape(row[column.id])).join(","),
      ),
    ].join("\r\n")
  );
}

export function downloadFile(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
