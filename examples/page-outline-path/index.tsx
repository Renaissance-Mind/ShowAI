import React from "react";
import "./style.css";
export default function ChapterPath({
  props,
  data,
  outline,
  navigate,
  setBranchExpanded,
}) {
  if (!outline) return <p>在 Page 的目录设置中使用此组件。</p>;
  const expanded = new Set(outline.expandedItemIds);
  const visit = (items) => (
    <ol>
      {items.map((item) => (
        <li key={item.id}>
          <div className="path-row">
            {item.children.length > 0 && (
              <button
                className="path-toggle"
                aria-label={`${expanded.has(item.id) ? "收起" : "展开"}${item.title}`}
                aria-expanded={expanded.has(item.id)}
                onClick={() =>
                  setBranchExpanded(item.id, !expanded.has(item.id))
                }
              >
                {expanded.has(item.id) ? "−" : "+"}
              </button>
            )}
            <button
              className="path-link"
              aria-current={
                outline.activeItemId === item.id ? "location" : undefined
              }
              onClick={() =>
                item.navigable
                  ? navigate(item.id)
                  : setBranchExpanded(item.id, !expanded.has(item.id))
              }
            >
              {item.title}
            </button>
          </div>
          {expanded.has(item.id) && visit(item.children)}
        </li>
      ))}
    </ol>
  );
  return (
    <nav
      className="chapter-path"
      aria-label="章节路径"
      style={{ "--path-gap": `${(props ?? data).gap}px` }}
    >
      {visit(outline.items)}
    </nav>
  );
}
