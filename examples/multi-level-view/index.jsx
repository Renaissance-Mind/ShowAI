import React, { useMemo, useState, useRef, useEffect } from "react";
import {
  Flowchart,
  LayerDiagram,
  ComponentInteractions,
} from "showai:components";
import { buildLevels, levelPath, sameTarget } from "./model.js";
import "./style.css";

// The navigator works with any declared React component. Its adapter only lists
// the stable interaction targets that the child component actually exposes.
export const renderers = {
  flowchart: {
    Component: Flowchart,
    targets: (props) =>
      props.flows.flatMap((flow) =>
        flow.nodes.map((node) => ({
          type: "node",
          scope: flow.id,
          id: node.id,
        })),
      ),
  },
  "layer-diagram": {
    Component: LayerDiagram,
    targets: (props) =>
      props.layers.flatMap((layer) =>
        layer.modules.map((module) => ({
          type: "module",
          scope: layer.id,
          id: module.id,
        })),
      ),
  },
};
export function readData(data) {
  const levels = buildLevels(data, renderers);
  return {
    derived: true,
    root: data.root,
    views: [...levels.values()].map((level) => ({
      id: level.id,
      parentId: level.parentId,
      kind: level.component.kind,
      depth: levelPath(levels, level.id).length,
      opens: [...new Set(level.bindings.map((binding) => binding.to))],
      bindingCount: level.bindings.length,
    })),
  };
}
export function createMultiLevelView(registry) {
  return function MultiLevelView({ data, viewState, onViewState }) {
    const levels = useMemo(() => buildLevels(data, registry), [data]);
    const [chosen, setChosen] = useState(viewState?.level || data.root);
    const [direction, setDirection] = useState("in");
    const current = levels.get(chosen) || levels.get(data.root);
    const path = levelPath(levels, current.id);
    const frame = useRef(null),
      nav = useRef(null),
      navigated = useRef(false);
    const choose = (id) => {
      if (!levels.has(id) || id === current.id) return;
      setDirection(levelPath(levels, id).length < path.length ? "out" : "in");
      navigated.current = true;
      setChosen(id);
      onViewState?.(id === data.root ? undefined : { level: id });
    };
    useEffect(() => {
      if (nav.current) nav.current.scrollLeft = nav.current.scrollWidth;
      if (navigated.current) frame.current?.focus({ preventScroll: true });
    }, [current.id]);
    const bindings = current.bindings;
    const targets = useMemo(
      () => bindings.map((binding) => binding.source),
      [bindings],
    );
    const onActivate = (target) => {
      const binding = bindings.find((item) => sameTarget(item.source, target));
      if (binding) choose(binding.to);
    };
    const Renderer = registry[current.component.kind].Component;
    return (
      <section
        className="mlv"
        aria-label={data.title}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            !event.defaultPrevented &&
            !event.target.matches("input,textarea,[contenteditable=true]") &&
            current.parentId
          ) {
            event.preventDefault();
            event.stopPropagation();
            choose(current.parentId);
          }
        }}
      >
        <nav className="mlv-nav" aria-label="层级路径">
          <button
            type="button"
            aria-label="返回上层"
            disabled={!current.parentId}
            onClick={() => choose(current.parentId)}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="m14 5-7 7 7 7" />
            </svg>
          </button>
          <div ref={nav} className="mlv-path">
            {path.map((level, index) => (
              <React.Fragment key={level.id}>
                {index > 0 && <span aria-hidden="true">/</span>}
                {level.id === current.id ? (
                  <strong aria-current="location">{level.label}</strong>
                ) : (
                  <button type="button" onClick={() => choose(level.id)}>
                    {level.label}
                  </button>
                )}
              </React.Fragment>
            ))}
          </div>
        </nav>
        <div
          ref={frame}
          key={current.id}
          className="mlv-view"
          data-direction={direction}
          tabIndex="-1"
          role="region"
          aria-label={current.label}
        >
          <ComponentInteractions targets={targets} onActivate={onActivate}>
            <Renderer data={current.component.props} readOnly={true} />
          </ComponentInteractions>
        </div>
      </section>
    );
  };
}
export default createMultiLevelView(renderers);
