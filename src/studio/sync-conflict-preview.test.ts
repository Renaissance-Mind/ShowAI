import { describe, expect, it } from "vitest";
import { conflictPreview } from "./sync-conflict-preview";

const encoded = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64");

describe("retained sync conflict previews", () => {
  it("shows changes beyond a large shared resource without including that resource", () => {
    const common = { image: "data:image/png;base64," + "x".repeat(6_000_000) };
    const preview = conflictPreview({
      local: encoded({
        document: {
          common,
          title: "本地标题",
          content: [{ text: "本地内容" }],
        },
      }),
      remote: encoded({
        document: {
          common,
          title: "服务器标题",
          content: [{ text: "服务器内容" }],
        },
      }),
    });
    expect(preview.local).toContain("本地内容");
    expect(preview.remote).toContain("服务器内容");
    expect(preview.local).not.toContain("data:image");
    expect(preview.description).toContain("2 处字段差异");
  });

  it("keeps deletions and binary files readable without throwing", () => {
    expect(
      conflictPreview({ local: null, remote: encoded({ title: "保留" }) })
        .local,
    ).toBe("已删除");
    expect(
      conflictPreview({
        local: Buffer.from([0, 255, 254]).toString("base64"),
        remote: null,
      }).local,
    ).toContain("二进制文件（3 字节）");
  });

  it("shows different text after a long shared prefix", () => {
    const prefix = "相同内容".repeat(10_000);
    const preview = conflictPreview({
      local: encoded({ text: prefix + "本地修改" }),
      remote: encoded({ text: prefix + "服务器修改" }),
    });
    expect(preview.local).toContain("本地修改");
    expect(preview.remote).toContain("服务器修改");
    expect(preview.local).toContain("相同开头已省略");
  });

  it("labels missing fields and bounds previews without hiding truncation", () => {
    const preview = conflictPreview({
      local: encoded({ title: "x".repeat(10_000), old: 1 }),
      remote: encoded({ title: "new", added: true }),
    });
    expect(preview.local).toContain("预览已截断");
    expect(preview.remote).toContain("此版本中不存在");
    const many = conflictPreview({
      local: encoded(Array(60).fill("a")),
      remote: encoded(Array(60).fill("b")),
    });
    expect(many.description).toContain("前 40 处");
  });
});
