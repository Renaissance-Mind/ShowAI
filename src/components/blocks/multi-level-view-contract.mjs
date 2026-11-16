import { componentObjects } from "../../contract/component-contract.mjs";
import { builtinComponentContract } from "../../contract/builtin-contracts.mjs";
import { validateFlowchartData } from "./flowchart-contract.mjs";
import { validateDocDiagramData } from "./doc-diagrams-contract.mjs";
import { validateDocBrowseData } from "./doc-browse-contract.mjs";
import { validateRichTextData } from "../../document/rich-text.mjs";

export const MULTI_LEVEL_LIMITS = { levels: 80, bindings: 100, widgets: 200 };
const object = (value, path, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object.`);
  for (const key of Object.keys(value))
    if (keys && !keys.includes(key))
      throw new Error(`${path}.${key} is not supported.`);
};
const text = (value, path) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Array.from(value).length > 200
  )
    throw new Error(`${path} must be non-empty text up to 200 characters.`);
};
const list = (value, path, min, max) => {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new Error(`${path} must contain ${min} to ${max} items.`);
};
export function sameMultiLevelTarget(a, b) {
  return a.type === b.type && a.scope === b.scope && a.id === b.id;
}
export function multiLevelContent(level) {
  return (
    level.content ?? {
      type: "doc",
      content: [
        {
          type: "widget",
          attrs: {
            id: `${level.id}-component`,
            kind: level.component.kind,
            data: level.component.props,
          },
        },
      ],
    }
  );
}
export function multiLevelWidgets(level) {
  const widgets = [];
  const visit = (node) => {
    if (node.type === "widget" || node.type === "inlineWidget")
      widgets.push(node);
    for (const child of node.content ?? []) visit(child);
  };
  visit(multiLevelContent(level));
  return widgets;
}
export function multiLevelBindingBlock(level, binding) {
  const widgets = multiLevelWidgets(level);
  if (binding.blockId !== undefined) return binding.blockId;
  if (widgets.length !== 1)
    throw new Error(
      `View ${level.id}: bindings need blockId when the content has multiple components.`,
    );
  return widgets[0].attrs.id;
}
export function multiLevelTargets(kind, props) {
  const contract =
    kind === "custom" ? props.contract : builtinComponentContract(kind);
  if (!contract) return undefined;
  return componentObjects(contract, kind === "custom" ? props.props : props);
}
export function multiLevelPath(levels, id) {
  const path = [];
  while (levels.has(id)) {
    const level = levels.get(id);
    path.unshift(level);
    id = level.parentId;
  }
  return path;
}
export function validateMultiLevelViewData(data, validateChild) {
  object(data, "multi-level-view", ["title", "root", "levels"]);
  text(data.title, "title");
  text(data.root, "root");
  list(data.levels, "levels", 1, MULTI_LEVEL_LIMITS.levels);
  const levels = new Map();
  for (const [index, level] of data.levels.entries()) {
    const at = `levels[${index}]`;
    object(level, at, [
      "id",
      "parentId",
      "label",
      "content",
      "component",
      "bindings",
    ]);
    text(level.id, `${at}.id`);
    if (levels.has(level.id))
      throw new Error(`${at}.id duplicates ${level.id}.`);
    levels.set(level.id, level);
    if (level.parentId !== null) text(level.parentId, `${at}.parentId`);
    text(level.label, `${at}.label`);
    if ((level.content !== undefined) === (level.component !== undefined))
      throw new Error(
        `${at} needs exactly one of content or legacy component.`,
      );
    if (level.component !== undefined) {
      object(level.component, `${at}.component`, ["kind", "props"]);
      text(level.component.kind, `${at}.component.kind`);
      object(level.component.props, `${at}.component.props`);
      if (level.component.kind === "custom")
        throw new Error(
          `${at}: custom components need content with a native widget reference so their exact package is exported.`,
        );
    }
    try {
      validateRichTextData({
        content: multiLevelContent(level),
        format: "richtext",
      });
    } catch (error) {
      throw new Error(`${at}.content: ${error.message}`);
    }
    const widgets = multiLevelWidgets(level);
    list(widgets, `${at}.content components`, 0, MULTI_LEVEL_LIMITS.widgets);
    const widgetIds = new Set();
    for (const widget of widgets) {
      object(widget.attrs, `${at}.content widget attrs`);
      text(widget.attrs.id, `${at}.content widget id`);
      if (widgetIds.has(widget.attrs.id))
        throw new Error(
          `${at}.content duplicates component block id ${widget.attrs.id}.`,
        );
      widgetIds.add(widget.attrs.id);
      const { kind, data: props } = widget.attrs;
      text(kind, `${at}.component.kind`);
      if (
        !/^[a-z][a-z0-9-]{0,79}$/.test(kind) ||
        ["multi-level-view", "region", "page", "board"].includes(kind)
      )
        throw new Error(
          `${at}.component.kind must identify a display component; native containers belong in content.`,
        );
      object(props, `${at}.component.props`);
      try {
        if (validateChild) validateChild(kind, props);
        else if (kind === "flowchart") validateFlowchartData(props);
        else if (kind === "layer-diagram") validateDocDiagramData(kind, props);
        else if (kind === "card-grid") validateDocBrowseData(kind, props);
      } catch (error) {
        throw new Error(`${at}.component.props: ${error.message}`);
      }
    }
    list(level.bindings, `${at}.bindings`, 0, MULTI_LEVEL_LIMITS.bindings);
    for (const [bi, binding] of level.bindings.entries()) {
      const bp = `${at}.bindings[${bi}]`;
      object(binding, bp, ["event", "blockId", "source", "to"]);
      if (binding.event !== undefined) text(binding.event, `${bp}.event`);
      text(binding.to, `${bp}.to`);
      if (binding.blockId !== undefined) text(binding.blockId, `${bp}.blockId`);
      object(binding.source, `${bp}.source`, ["type", "scope", "id"]);
      for (const key of ["type", "scope", "id"])
        text(binding.source[key], `${bp}.source.${key}`);
    }
  }
  if (!levels.has(data.root) || levels.get(data.root).parentId !== null)
    throw new Error(
      "root must identify the unique root view with parentId=null.",
    );
  for (const [index, level] of data.levels.entries()) {
    if (level.id !== data.root && !levels.has(level.parentId))
      throw new Error(
        `levels[${index}].parentId must identify an existing parent view.`,
      );
    const seen = new Set();
    let current = level;
    while (current) {
      if (seen.has(current.id))
        throw new Error(
          `levels[${index}].parentId creates a cycle at ${current.id}.`,
        );
      seen.add(current.id);
      current = levels.get(current.parentId);
    }
  }
  for (const [index, level] of data.levels.entries()) {
    const sources = new Set(),
      widgets = multiLevelWidgets(level);
    for (const [bi, binding] of level.bindings.entries()) {
      const bp = `levels[${index}].bindings[${bi}]`,
        blockId = multiLevelBindingBlock(level, binding);
      const widget = widgets.find((node) => node.attrs.id === blockId);
      if (!widget)
        throw new Error(
          `${bp}.blockId does not identify a component in this view.`,
        );
      const key = JSON.stringify([
        blockId,
        binding.event ?? "activate",
        binding.source.type,
        binding.source.scope,
        binding.source.id,
      ]);
      if (sources.has(key))
        throw new Error(`${bp}.source duplicates a binding in this view.`);
      sources.add(key);
      const targets = multiLevelTargets(widget.attrs.kind, widget.attrs.data);
      const contract =
        widget.attrs.kind === "custom"
          ? widget.attrs.data.contract
          : builtinComponentContract(widget.attrs.kind);
      if (
        contract &&
        !(contract.events ?? []).some(
          (event) =>
            event.name === (binding.event ?? "activate") &&
            event.entity === binding.source.type,
        )
      )
        throw new Error(`${bp}.event is not declared for this object type.`);
      if (
        targets &&
        !targets.some((target) => sameMultiLevelTarget(target, binding.source))
      )
        throw new Error(
          `${bp}.source does not identify an existing component target.`,
        );
      if (
        !levels.has(binding.to) ||
        levels.get(binding.to).parentId !== level.id
      )
        throw new Error(`${bp}.to must identify a direct child view.`);
    }
    if (
      level.parentId !== null &&
      !levels
        .get(level.parentId)
        .bindings.some((binding) => binding.to === level.id)
    )
      throw new Error(`levels[${index}] has no entry binding from its parent.`);
  }
  return data;
}
