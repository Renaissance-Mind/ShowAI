import { describe, expect, it } from "vitest";
import { redact } from "./redact";

describe("redact", () => {
  it("replaces the library before the home directory that contains it", () => {
    expect(
      redact(
        "ENOSPC: open '/Users/ada/.showai/local/drafts/a.tmp' in /Users/ada/Desktop",
        { home: "/Users/ada", library: "/Users/ada/.showai" },
      ),
    ).toBe("ENOSPC: open '<library>/local/drafts/a.tmp' in ~/Desktop");
  });

  it("does not replace a longer sibling path that shares the prefix", () => {
    expect(redact("/Users/ada2/x", { home: "/Users/ada" })).toBe("~/x");
    expect(
      redact("/data/lib-old/x and /data/lib/y", { library: "/data/lib" }),
    ).toBe("/data/lib-old/x and <library>/y");
  });

  it("hides home directories it was not told about", () => {
    expect(redact("at /Users/bob/project and C:\\Users\\Bob\\x")).toBe(
      "at ~/project and ~\\x",
    );
    expect(redact("path=/home/carol/.config")).toBe("path=~/.config");
    expect(redact("https://example.com/home/page")).toBe(
      "https://example.com/home/page",
    );
    expect(redact("/Users/Shared/ShowAI")).toBe("/Users/Shared/ShowAI");
  });

  it("removes tokens and keys", () => {
    const text = [
      "Authorization: Bearer abcdef1234567890",
      "key sk-proj-ABCDEF1234567890abcdef",
      "gh ghp_0123456789abcdefABCDEF0123",
      "slack xoxb-1234-5678-abcdefgh",
      'body {"api_key": "plainsecretvalue", "password":"hunter22"}',
      "url ?token=abcd1234&x=1",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
    ].join("\n");
    const result = redact(text);
    expect(result).toBe(
      [
        "Authorization: Bearer [redacted]",
        "key [redacted]",
        "gh [redacted]",
        "slack [redacted]",
        'body {"api_key": "[redacted]", "password":"[redacted]"}',
        "url ?token=[redacted]&x=1",
        "jwt [redacted]",
      ].join("\n"),
    );
  });

  it("shortens UUIDs only when asked", () => {
    const text = "page 8f2c1d3e-1111-4222-8333-944445555666";
    expect(redact(text)).toBe(text);
    expect(redact(text, { truncateIds: true })).toBe("page 8f2c1d3e");
  });

  it("leaves ordinary messages unchanged", () => {
    const text = "Another library operation is still running.";
    expect(redact(text)).toBe(text);
  });

  it("masks secret query parameters and authorization values", () => {
    expect(redact("https://x/cb?code=123456&flow=a&key=abc")).toBe(
      "https://x/cb?code=[redacted]&flow=a&key=[redacted]",
    );
    expect(redact("authorization=abcdef123")).toBe("authorization=[redacted]");
    expect(redact("Authorization: Bearer abcdef123456")).toBe(
      "Authorization: Bearer [redacted]",
    );
    expect(redact("code: 'ENOENT'")).toBe("code: 'ENOENT'");
  });
});
