import type {
  ChartData,
  ChartSeries,
  DatabaseColumn,
  DatabaseRow,
} from "./types";
import { translator } from "../../i18n";
import messages from "../../i18n/messages/blockHelpers";

const t = translator(messages);

export const COLORS = [
  "#120a8f",
  "#5147b8",
  "#8179c2",
  "#4674af",
  "#6b78a8",
  "#898892",
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
    throw new Error(t("chartData.notObject"));
  const { labels, series } = parsed as Partial<ChartData>;
  if (
    !Array.isArray(labels) ||
    !labels.every((label) => typeof label === "string")
  )
    throw new Error(t("chartData.labels"));
  if (!Array.isArray(series)) throw new Error(t("chartData.series"));
  if (labels.length > 500 || series.length > 20)
    throw new Error(t("chartData.tooLarge"));
  for (const item of series) {
    if (!item || typeof item.name !== "string" || !Array.isArray(item.values))
      throw new Error(t("chartData.seriesShape"));
    if (item.values.length !== labels.length)
      throw new Error(t("chartData.length", { name: item.name }));
    if (
      !item.values.every(
        (value) => typeof value === "number" && Number.isFinite(value),
      )
    )
      throw new Error(t("chartData.finite", { name: item.name }));
    if (
      item.color !== undefined &&
      (typeof item.color !== "string" ||
        !/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(item.color))
    )
      throw new Error(t("chartData.color", { name: item.name }));
  }
  return { labels, series };
}

/** CSV of database rows; `cellText` writes each typed value (default: the stored text). */
export function toCsv(
  columns: DatabaseColumn[],
  rows: DatabaseRow[],
  cellText: (row: DatabaseRow, column: DatabaseColumn) => string = (row, column) =>
    String(row[column.id] ?? ""),
): string {
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
        columns.map((column) => escape(cellText(row, column))).join(","),
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
