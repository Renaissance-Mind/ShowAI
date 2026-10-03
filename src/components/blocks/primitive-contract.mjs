export function validatePrimitiveData(kind, data) {
  for (const key of ["color", "backgroundColor"])
    if (data[key] !== undefined && typeof data[key] !== "string")
      throw new Error(`${key} 必须是文字。`);
  for (const [key, min, max] of [
    ["fontSize", 8, 200],
    ["padding", 0, 200],
    ["radius", 0, 200],
    ["width", 1, 10000],
    ["height", 1, 10000],
  ])
    if (
      data[key] !== undefined &&
      (typeof data[key] !== "number" ||
        !Number.isFinite(data[key]) ||
        data[key] < min ||
        data[key] > max)
    )
      throw new Error(`${key} 数值超出范围。`);
  if (
    data.align !== undefined &&
    !["left", "center", "right", "justify"].includes(String(data.align))
  )
    throw new Error("不支持此对齐方式。");
  if (
    kind === "text" &&
    (typeof data.content !== "string" ||
      data.content.length > 1000000 ||
      (data.format !== undefined &&
        !["markdown", "plain"].includes(String(data.format))))
  )
    throw new Error("文本框需要文字内容和有效格式。");
  if (kind === "image") {
    for (const key of ["src", "alt", "caption"])
      if (
        (key === "src" || data[key] !== undefined) &&
        typeof data[key] !== "string"
      )
        throw new Error(`${key} 必须是文字。`);
    if (
      data.fit !== undefined &&
      !["contain", "cover"].includes(String(data.fit))
    )
      throw new Error("不支持此图像裁切方式。");
  }
  if (
    ["callout", "toggle", "code"].includes(kind) &&
    typeof data.content !== "string"
  )
    throw new Error("组件需要文字内容。");
  if (kind === "table") {
    if (
      !Array.isArray(data.columns) ||
      !data.columns.length ||
      data.columns.length > 100 ||
      data.columns.some((column) => typeof column !== "string")
    )
      throw new Error("表格需要 1 到 100 个文字表头。");
    if (
      !Array.isArray(data.rows) ||
      data.rows.length > 1000 ||
      data.rows.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== data.columns.length ||
          row.some(
            (cell) =>
              !["string", "number", "boolean"].includes(typeof cell) ||
              (typeof cell === "number" && !Number.isFinite(cell)),
          ),
      )
    )
      throw new Error(
        "表格各行必须和表头列数一致，单元格只支持文字、数字和布尔值。",
      );
  }
}
