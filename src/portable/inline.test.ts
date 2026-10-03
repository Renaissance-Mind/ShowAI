import { describe, expect, it } from "vitest";
import { toInlineFragment } from "./inline.mjs";

const built =
  '<html><head><script type="module">const parse = text => `<body>${text}</body>`;const root=document.getElementById(`root`);const data=document.getElementById(`showai-data`);window.document.documentElement.dataset.theme="light";</script><style>:root{color:red}body{margin:0}</style></head><body><div id="root"></div><script type="application/json" id="showai-data">{"format":"showai"}</script></body></html>';

describe("inline page delivery", () => {
  it("keeps the real mount when the bundle contains a DOMParser body string", () => {
    const fragment = toInlineFragment(built, "showai-test");
    expect(fragment).toContain('<div id="showai-test-root"></div>');
    expect(fragment).toContain('getElementById("showai-test-root")');
    expect(fragment).toContain('getElementById("showai-test-data")');
    expect(fragment).toContain('getElementById("showai-test").dataset.theme');
    expect(fragment).not.toMatch(/<!doctype\s|<\s*(?:html|head|body)(?:\s|>)/i);
    expect(fragment).toContain("`\\x3cbody>${text}</body>`");
  });
  it("scopes styles and keeps source data intact", () => {
    const fragment = toInlineFragment(built, "showai-test");
    expect(fragment).toContain("@scope (#showai-test)");
    expect(fragment).toContain(":scope{color:red}");
    expect(fragment).toContain('{"format":"showai"}');
    expect(fragment).not.toContain('src="');
  });
  it("rejects referenced legacy component packages without a conversation runtime", () => {
    const artifact = {
      format: "showai",
      version: 1,
      document: {
        content: {
          type: "doc",
          content: [
            {
              type: "widget",
              attrs: {
                kind: "custom",
                data: {
                  componentId: "old-package",
                  version: "1.0.0",
                  props: {},
                },
              },
            },
          ],
        },
      },
      components: [
        { id: "old-package", version: "1.0.0", html: "standalone only" },
      ],
    };
    const legacy = built.replace(
      '{"format":"showai"}',
      JSON.stringify(artifact),
    );
    expect(() => toInlineFragment(legacy)).toThrow(
      "Import its rebuilt source as a new version",
    );
    const compatible = built.replace(
      '{"format":"showai"}',
      JSON.stringify({
        ...artifact,
        components: [
          {
            ...artifact.components[0],
            inline: { script: "var ShowAIInlineComponent={};", styles: "" },
          },
        ],
      }),
    );
    expect(toInlineFragment(compatible)).toContain("old-package");
  });
  it("rejects invalid roots and oversize pages instead of emitting broken references", () => {
    expect(() => toInlineFragment(built, 'bad"></section>')).toThrow("id");
    expect(() =>
      toInlineFragment(built.replace('<div id="root"></div>', "")),
    ).toThrow("mount");
    expect(() =>
      toInlineFragment(
        built.replace("color:red", "color:red;" + " ".repeat(1_000_000)),
      ),
    ).toThrow("1 MB");
  });
});
