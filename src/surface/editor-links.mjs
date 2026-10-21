import { isSafeUrl } from "../portable/validation.mjs";
import { validateCubicInk } from "./portable-ink-v2.mjs";
import { richTextDocument } from "../components/rich-text/model.mjs";

// These are closed payload envelopes in the canonical model, not arbitrary
// widget data identified by a coincidental key. Their internals contain numeric
// brush samples, binary archive provenance or hash-protected causal records;
// they cannot contain editable link marks. This repair pass is not validation:
// the normal complete save validator still rejects malformed payload values.
const record = value => value && typeof value === "object" && !Array.isArray(value);
const only = (value, keys) => record(value) && Object.keys(value).every(key => keys.has(key));
const portableKeys = new Set(["format","brushVersion","brush","strokeCount","width","opacity","extent","samples","transform","mask","sourceDrawing","seed","createdAt"]);
const nativeKeys = new Set(["format","drawing","preview","darkPreview","strokeCount","extent"]);
const inputKeys = new Set(["format","sourceID","configuration","raw","curves","fragmentCount","compositeOpacity","composite"]);
const configurationKeys = new Set(["version","mode","width","creationZoom","fitTolerance","flattenTolerance","positionWindow","jitterWindow","forceBackward","forceForward","forceTime","minimumFraction","maximumFraction","curveBlend","estimateTimeout"]);
const wireKeys = new Set(["format","clock","level","contexts","levels","digests","eventDigests","strokes"]);
const groupKeys = new Set(["version","extent","sourceDrawing"]);
const extent = value => Array.isArray(value) && value.length === 2;
const portable = value => only(value,portableKeys) && value.format === "showai-ink-v1" && value.brushVersion === 1 && value.strokeCount === 1 &&
  ["pen","marker","pencil","monoline"].includes(value.brush) && extent(value.extent) && Array.isArray(value.samples) && value.samples.length > 0 &&
  Array.isArray(value.transform) && value.transform.length === 6;
const native = value => portable(value) || only(value,nativeKeys) && value.format === "showai-pencilkit-v1" &&
  typeof value.drawing === "string" && typeof value.preview === "string" && (value.extent === undefined || extent(value.extent));
function cubic(value) {
  if(value?.format !== "showai-ink-v2")return false;
  // An input boundary: unknown or malformed fields retain the ordinary link walk.
  try { validateCubicInk(value); return true; } catch { return false; }
}
function opaqueField(context,key,value) {
  const node=context?.node;
  if(context?.kind === "attrs" && node?.type === "drawing") {
    if(key === "ink") return native(value) || cubic(value);
    if(key === "inkFragments") return Array.isArray(value) && value.every(portable);
    if(key === "inkInput") return only(value,inputKeys) && value.format === "showai-input-v1" && typeof value.sourceID === "string" &&
      only(value.configuration,configurationKeys) && value.configuration.version === 1 && Array.isArray(value.raw) && Array.isArray(value.curves);
  }
  if((context?.kind === "attrs" && node?.type === "image" || context?.kind === "imageData") && key === "nativeInk") return native(value);
  if(context?.kind === "attrs" && node?.type === "surface" && node.attrs?.kind === "board" && key === "inkState")
    return only(value,wireKeys) && value.format === "showai-ink-state-v1" && record(value.clock) && record(value.contexts) && record(value.strokes);
  if(context?.kind === "attrs" && node?.type === "region" && key === "inkArchiveGroup")
    return only(value,groupKeys) && value.version === 1 && extent(value.extent) && typeof value.sourceDrawing === "string";
  return false;
}
function childContext(context,node,key) {
  if(context?.kind === "document" && key === "content") return {kind:"node"};
  if(context?.kind === "node") {
    if(key === "content") return {kind:"nodes"};
    if(key === "attrs") return {kind:"attrs",node};
  }
  if(context?.kind === "attrs" && context.node?.type === "widget" && context.node.attrs?.kind === "image" && key === "data")
    return {kind:"imageData",node:context.node};
}

/** Repair editor link marks without dropping their text or relaxing saved-page validation. */
export function repairEditorLinks(document, diagnostics) {
  const repairs = [];
  if(diagnostics) { diagnostics.visitedValues=0;diagnostics.opaqueFields=0; }
  const visit = (value, path, context) => {
    if(diagnostics)diagnostics.visitedValues++;
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      const next = value.map((item, index) => visit(item, `${path}[${index}]`, context?.kind === "nodes" ? {kind:"node"} : undefined));
      return next.some((item, index) => item !== value[index]) ? next : value;
    }
    if (
      value.type === "widget" &&
      value.attrs?.kind === "text" &&
      typeof value.attrs.data?.content === "string" &&
      value.attrs.data.format !== "plain"
    ) {
      const parsed = richTextDocument(value.attrs.data);
      const repaired = visit(parsed, `${path}.attrs.data.content`);
      if (repaired !== parsed)
        value = {
          ...value,
          attrs: {
            ...value.attrs,
            data: {
              ...value.attrs.data,
              content: repaired,
              format: "richtext",
            },
          },
        };
    }
    let next = value;
    for (const [key, child] of Object.entries(value)) {
      let updated;
      if(opaqueField(context,key,child)) {
        if(diagnostics)diagnostics.opaqueFields++;
        updated=child;
      } else if (key === "marks" && Array.isArray(child)) {
        updated = child.flatMap((mark, index) => {
          if (mark?.type !== "link" || isSafeUrl(mark.attrs?.href))
            return [mark];
          const raw = mark.attrs?.href;
          let href = typeof raw === "string" ? raw.trim() : "";
          if (href.startsWith("//")) href = "https:" + href;
          else if (/^www\.[^\s/]+\.[^\s]+$/i.test(href))
            href = "https://" + href;
          const safe = isSafeUrl(href);
          repairs.push({
            path: `${path}.marks[${index}]`,
            action: safe ? "normalized" : "unlinked",
          });
          return safe ? [{ ...mark, attrs: { ...mark.attrs, href } }] : [];
        });
        if (
          updated.length === child.length &&
          updated.every((item, index) => item === child[index])
        )
          updated = child;
      } else updated = visit(child, `${path}.${key}`,childContext(context,value,key));
      if (updated !== child) {
        if (next === value) next = { ...value };
        if (key === "marks" && !updated.length) delete next.marks;
        else next[key] = updated;
      }
    }
    return next;
  };
  return { document: visit(document, "document", {kind:"document"}), repairs };
}
