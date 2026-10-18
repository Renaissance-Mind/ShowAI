import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Drawing } from "./Drawing";
import { finishBoardDrawing } from "./board-drawing.mjs";
import { blankDocument } from "../core/catalog";
import { createResource } from "./containers.mjs";
import { addNode } from "./editing";
import { parseArtifact, serializeArtifact } from "../portable/validation.mjs";
import { BoardStyleControls } from "./BoardStyleControls";

it("preserves pressure in saved strokes and renders fixed and pressure widths differently", () => {
  const points = [{x:20,y:30,pressure:0.2},{x:50,y:40,pressure:0.9},{x:90,y:30,pressure:0.4}];
  const value = finishBoardDrawing("pen",{color:"#123456",fillColor:"none",strokeWidth:6,pressure:true},{origin:points[0],release:points[2],points,scale:1,moved:true});
  const document = createResource(blankDocument(),"board");
  const saved = addNode(document,value.node,value.frame,document.content.attrs!.id);
  const restored = parseArtifact(serializeArtifact(saved)).document.content.content![0];
  expect(restored.attrs!.points.map((p:{pressure:number})=>p.pressure)).toEqual([0.2,0.9,0.4]);
  const dynamic = renderToStaticMarkup(createElement(Drawing,{node:restored}));
  const fixed = renderToStaticMarkup(createElement(Drawing,{node:{...restored,attrs:{...restored.attrs,pressure:false}}}));
  expect(dynamic).toContain('stroke="none"');
  expect(fixed).not.toContain('stroke="none"');
});

it.each([["pen",12],["highlighter",20],["eraser",64]] as const)("limits %s controls while exposing its actual stroke mode",(tool,max)=>{
  const render=()=>renderToStaticMarkup(createElement(BoardStyleControls,{tool,style:{color:"#252629",fillColor:"none",strokeWidth:6,pressure:false},nodes:[],onChange:()=>{}}));
  const markup=render();
  expect(markup).toContain(`max="${max}"`);
  // Pressure only exists on the iOS app's pencil input; desktop never offers it.
  expect(markup).not.toContain('class="board-pressure-toggle"');
  if(tool!=="eraser") expect(markup).toContain('class="board-color-presets"');
  else expect(markup).not.toContain('class="board-color-presets"');
  const previous=globalThis.document;
  globalThis.document={documentElement:{dataset:{native:"ios"}}} as unknown as Document;
  try {
    const ios=render();
    if(tool!=="eraser") expect(ios).toContain('class="board-pressure-toggle"');
    else expect(ios).not.toContain('class="board-pressure-toggle"');
  } finally {
    globalThis.document=previous;
  }
});
