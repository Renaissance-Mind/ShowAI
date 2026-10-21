import React from "react";
import "./style.css";
export default function ReadingIndex({
  props,
  data,
  outline,
  navigate,
  setBranchExpanded,
}) {
  if (!outline) return <p>在 Page 的目录设置中使用此组件。</p>;
  const options = props ?? data,
    expanded = new Set(outline.expandedItemIds);
  const render = (items, prefix = "") => (
    <ol>
      {items.map((item, index) => {
        const number = prefix + (index + 1);
        return (
          <li key={item.id}>
            <div className="index-row">
              {item.children.length > 0 && (
                <button
                  aria-label={`${expanded.has(item.id) ? "收起" : "展开"}${item.title}`}
                  aria-expanded={expanded.has(item.id)}
                  onClick={() =>
                    setBranchExpanded(item.id, !expanded.has(item.id))
                  }
                >
                  {expanded.has(item.id) ? "⌄" : "›"}
                </button>
              )}
              <button
                className="index-link"
                aria-current={
                  outline.activeItemId === item.id ? "location" : undefined
                }
                onClick={() =>
                  item.navigable
                    ? navigate(item.id)
                    : setBranchExpanded(item.id, !expanded.has(item.id))
                }
              >
                {options.numbering && <span>{number}</span>}
                {item.title}
              </button>
            </div>
            {item.children.length > 0 &&
              expanded.has(item.id) &&
              render(item.children, number + ".")}
          </li>
        );
      })}
    </ol>
  );
  return (
    <nav
      className="reading-index"
      aria-label="阅读索引"
      style={{ "--index-indent": `${options.indent}px` }}
    >
      {render(outline.items)}
    </nav>
  );
}
