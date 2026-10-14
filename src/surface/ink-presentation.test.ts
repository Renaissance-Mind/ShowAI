import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SurfaceContent } from "./SurfaceContent";
import { Widget } from "../components/blocks/Widget";
import { createResource } from "./containers.mjs";
import { blankDocument } from "../core/catalog";
import fixture from "./native-ink-fixture.json";

it("renders saved native strokes at their exact drawing bounds without card layout or automatic selection", () => {
  const document = createResource(blankDocument(), "board");
  const first = structuredClone(fixture.node),
    second = structuredClone(fixture.node);
  second.attrs.id = "second-stroke";
  document.content.content = [first, second];
  document.layout = {
    "native-ink": fixture.frame,
    "second-stroke": { x: 300, y: 250, width: 10, height: 8 },
  };
  const markup = renderToStaticMarkup(
    createElement(SurfaceContent, {
      document,
      container: document.content,
      renderContent: ({ content }) => {
        const node = content.content![0];
        return createElement(Widget, {
          kind: node.attrs!.kind,
          data: node.attrs!.data,
          readOnly: false,
        });
      },
    }),
  );
  expect(markup.match(/class="surface-object is-drawing"/g)).toHaveLength(2);
  expect(markup.match(/data-board-fixed-height="true"/g)).toHaveLength(2);
  expect(markup).toContain("left:300px;top:250px;width:10px");
  expect(markup).toContain("height:8px");
  expect(markup).not.toContain("is-selected");
  expect(markup).not.toContain("surface-object-header");
  expect(
    markup.match(/data-native-ink="true"/g) ??
      markup.match(/data-native-ink=""/g),
  ).toHaveLength(2);
});
