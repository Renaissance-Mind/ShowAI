import { describe, expect, it } from "vitest";
import { componentExternalUrl } from "./external-links";

describe("component external link boundary", () => {
  it("accepts both HTTP faculty pages and HTTPS recruitment pages", () => {
    expect(
      componentExternalUrl(
        "http://web.ee.tsinghua.edu.cn/liyong/zh_CN/index.htm",
      ),
    ).toBe("http://web.ee.tsinghua.edu.cn/liyong/zh_CN/index.htm");
    expect(componentExternalUrl("https://fi.ee.tsinghua.edu.cn/joinus/")).toBe(
      "https://fi.ee.tsinghua.edu.cn/joinus/",
    );
  });

  it("rejects executable, local, internal and malformed targets", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,test",
      "file:///etc/passwd",
      "showai://join?invite=test",
      "#/list",
      "research/source.md",
      "/relative",
      " https://example.com",
      "https://example.com/\n",
      "https://",
      null,
      {},
      42,
      "https://example.com/" + "x".repeat(8192),
    ])
      expect(componentExternalUrl(value)).toBeUndefined();
  });
});
