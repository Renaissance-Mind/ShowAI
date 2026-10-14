import { describe, expect, it } from "vitest";
import { mcpReaderHtml } from "./mcp-ui";

const script = mcpReaderHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

describe("MCP Apps reader", () => {
  it("ships a script that parses", () => {
    expect(script).not.toBe("");
    expect(() => new Function(script)).not.toThrow();
  });

  it("handles the host lifecycle beyond a successful result", () => {
    for (const method of [
      "ui/notifications/tool-input",
      "ui/notifications/tool-result",
      "ui/notifications/tool-cancelled",
      "ui/notifications/host-context-changed",
      "ui/update-model-context",
      "ui/open-link",
    ])
      expect(script).toContain(method);
  });
});
