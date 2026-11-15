import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ComponentInteractions,
  useComponentInteractions,
  sameComponentTarget,
  type ComponentTarget,
} from "./component-interactions";
const order = { type: "node", scope: "checkout", id: "order" };
const otherFlow = { ...order, scope: "returns" };
describe("component reading interactions", () => {
  it("requires the complete stable identity and preserves unbound behavior", () => {
    const received: ComponentTarget[] = [];
    let actions!: ReturnType<typeof useComponentInteractions>;
    function Probe() {
      actions = useComponentInteractions();
      return h("span", null, String(actions.canActivate(order)));
    }
    expect(renderToStaticMarkup(h(Probe))).toBe("<span>false</span>");
    expect(actions.activate(order)).toBe(false);
    expect(
      renderToStaticMarkup(
        h(ComponentInteractions, {
          targets: [order],
          onActivate: (t) => received.push(t),
          children: h(Probe),
        }),
      ),
    ).toBe("<span>true</span>");
    expect(actions.activate(otherFlow)).toBe(false);
    expect(actions.activate({ ...order, type: "module" })).toBe(false);
    expect(actions.activate(order)).toBe(true);
    expect(received).toEqual([order]);
    expect(sameComponentTarget(order, { ...order })).toBe(true);
  });
  it("isolates nested scopes without leaking an unmatched child action", () => {
    const received: string[] = [];
    let outer!: ReturnType<typeof useComponentInteractions>,
      inner!: ReturnType<typeof useComponentInteractions>;
    function Outer() {
      outer = useComponentInteractions();
      return null;
    }
    function Inner() {
      inner = useComponentInteractions();
      return null;
    }
    renderToStaticMarkup(
      h(ComponentInteractions, {
        targets: [order],
        onActivate: () => received.push("outer"),
        children: [
          h(Outer, { key: "outer" }),
          h(ComponentInteractions, {
            key: "inner",
            targets: [otherFlow],
            onActivate: () => received.push("inner"),
            children: h(Inner),
          }),
        ],
      }),
    );
    expect(inner.activate(order)).toBe(false);
    expect(inner.activate(otherFlow)).toBe(true);
    expect(outer.activate(order)).toBe(true);
    expect(received).toEqual(["inner", "outer"]);
  });
});
