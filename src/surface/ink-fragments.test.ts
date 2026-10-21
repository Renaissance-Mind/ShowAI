import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { PortableInkPaths } from "./PortableInkPaths";
import { createPortableInk, portableInkGeometry, portableNodeBounds, portableNodeFragments, portableNodeHit } from "./portable-ink.mjs";
import { drawingBounds, shapeHit } from "./drawing-geometry.mjs";

function stroke() {
  const primary = createPortableInk([{x:10,y:30},{x:50,y:30}], 8, [100,100], "marker", false);
  const continuation = createPortableInk([{x:50,y:30},{x:50,y:90}], 8, [100,100], "marker", false);
  primary.opacity = continuation.opacity = .35;
  return {type:"drawing", attrs:{id:"one-logical-stroke",tool:"highlighter",color:"#123456",strokeWidth:8,
    pressure:false,extent:[100,100],points:[{x:10,y:30},{x:50,y:90}],ink:primary,inkFragments:[continuation]}};
}

describe("logical portable ink fragments", () => {
  it("hit tests later fragments through the same rotated and scaled object", () => {
    const node = stroke();
    expect(portableNodeFragments(node)).toHaveLength(2);
    expect(portableNodeHit(node,{x:50,y:80}).inside).toBe(true);
    expect(portableNodeHit(node,{x:90,y:80}).inside).toBe(false);
    expect(portableNodeBounds(node).height).toBeGreaterThan(60);
    expect(drawingBounds(node)).toEqual(portableNodeBounds(node));
    // Scale 2x about the frame, rotate90 about its center(300,400).
    const frame={x:200,y:300,width:200,height:200,rotation:90};
    expect(shapeHit(node,frame,{x:240,y:400}).inside).toBe(true);
    expect(shapeHit(node,frame,{x:240,y:480}).inside).toBe(false);
  });
  it("composites all fragment contours once rather than multiplying marker alpha at joins", () => {
    const {attrs} = stroke();
    const html = renderToStaticMarkup(createElement("svg", null, createElement(PortableInkPaths,
      {ink:attrs.ink, fragments:attrs.inkFragments, color:attrs.color, width:attrs.strokeWidth, pressure:attrs.pressure})));
    expect(html.match(/opacity="0.35"/g)).toHaveLength(2); // light/dark variants, one group each
    expect(html.match(/data-portable-ink="1"/g)).toHaveLength(2);
    const continuation = portableInkGeometry(attrs.inkFragments[0],8,false).path;
    expect(html).toContain(continuation);
    expect(html).not.toMatch(/<path[^>]*opacity=/);
  });
  it("keeps fragment-specific masks before the logical stroke opacity", () => {
    const {attrs}=stroke();
    attrs.inkFragments[0].mask=[["M",45,60],["L",55,60],["L",55,95],["L",45,95],["Z"]];
    expect(portableNodeHit({attrs},{x:50,y:50}).inside).toBe(false);
    expect(portableNodeHit({attrs},{x:50,y:80}).inside).toBe(true);
    const html=renderToStaticMarkup(createElement("svg",null,createElement(PortableInkPaths,{ink:attrs.ink,fragments:attrs.inkFragments,color:attrs.color})));
    expect(html.match(/<clipPath /g)).toHaveLength(1);
    expect(html.match(/clip-path=/g)).toHaveLength(2);
    expect(html).not.toMatch(/<path[^>]*opacity=/);
  });
});
