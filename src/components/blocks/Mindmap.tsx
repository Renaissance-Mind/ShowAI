import {
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type CSSProperties,
} from "react";
import { SelectionToolbar } from "../../editor/SelectionToolbar";
import {
  Plus,
  Minus,
  Maximize2,
  Type,
  Trash2,
  ChevronRight,
  Undo2,
  Redo2,
} from "../../ui/icons";
import { BlockHeader } from "./shared";
import type { BlockProps } from "./types";
import {
  addMindmapNode,
  layoutMindmap,
  MAX_MINDMAP_NODES,
  mindmapChildren,
  promoteMindmapNode,
  removeMindmapNode,
  validateMindmapData,
  type MindmapData,
} from "./mindmap-contract.mjs";
import "./mindmap.css";

export function MindmapBlock({
  data: raw,
  onChange,
  readOnly = false,
}: BlockProps) {
  const data = useMemo(() => validateMindmapData(raw), [raw]);
  const editable = !readOnly && !!onChange;
  const root = data.nodes.find((node) => node.parentId === null)!;
  const [selected, setSelected] = useState(root.id);
  const [active, setActive] = useState(false);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(
    null,
  );
  const editingId = useRef<string | null>(null);
  const selectName = useRef(true);
  const [readingCollapsed, setReadingCollapsed] = useState<Set<string> | null>(
    null,
  );
  const collapsed =
    readingCollapsed ??
    new Set(data.nodes.filter((node) => node.collapsed).map((node) => node.id));
  const graph = useMemo(
    () => layoutMindmap(data, collapsed),
    [data, [...collapsed].join("\0")],
  );
  const [scale, setScale] = useState(1);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(
    null,
  );
  const section = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const menuId = useId();
  const history = useRef<{
    past: MindmapData[];
    future: MindmapData[];
    expected: string | null;
  }>({ past: [], future: [], expected: null });
  const [notice, setNotice] = useState("");
  const node = data.nodes.find((item) => item.id === selected) ?? root;
  const hasChildren = mindmapChildren(data, node.id).length > 0;
  const fit = () => {
    const element = viewport.current;
    if (element)
      setScale(
        Math.max(
          0.15,
          Math.min(
            1,
            (element.clientWidth - 20) / graph.width,
            (element.clientHeight - 20) / graph.height,
          ),
        ),
      );
  };
  useLayoutEffect(fit, []);
  useEffect(() => {
    const signature = JSON.stringify(data);
    if (
      history.current.expected !== null &&
      history.current.expected !== signature
    ) {
      history.current.past = [];
      history.current.future = [];
    }
    history.current.expected = signature;
  }, [data]);
  useEffect(() => {
    if (
      !graph.nodes.some((item) => item.id === selected) &&
      editing?.id !== selected
    )
      setSelected(root.id);
  }, [graph, selected, root.id, editing?.id]);
  const focus = (id: string) => {
    setSelected(id);
    requestAnimationFrame(() => {
      const button = buttons.current.get(id);
      button?.focus({ preventScroll: true });
      button?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };
  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      if (selectName.current) input.current?.select();
      else
        input.current?.setSelectionRange(
          editing.value.length,
          editing.value.length,
        );
      input.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [editing?.id, data.nodes.length]);
  useLayoutEffect(() => {
    if (!active || editing || !editable) {
      setAnchor(null);
      return;
    }
    const place = () => {
      const element = buttons.current.get(selected),
        canvas = viewport.current;
      if (!element || !canvas) return;
      const rect = element.getBoundingClientRect(),
        bounds = canvas.getBoundingClientRect();
      setAnchor(
        rect.bottom < bounds.top ||
          rect.top > bounds.bottom ||
          rect.right < bounds.left ||
          rect.left > bounds.right
          ? null
          : {
              left: Math.max(
                bounds.left,
                Math.min(bounds.right, rect.left + rect.width / 2),
              ),
              top: Math.max(bounds.top, rect.top),
            },
      );
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    const observer = new ResizeObserver(place);
    if (viewport.current) observer.observe(viewport.current);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      observer.disconnect();
    };
  }, [active, editing, editable, selected, graph, scale]);
  const change = (next: MindmapData) => {
    if (!editable || next === data) return;
    validateMindmapData(next);
    history.current.past = [...history.current.past.slice(-99), data];
    history.current.future = [];
    history.current.expected = JSON.stringify(next);
    setNotice("");
    onChange?.(next);
  };
  const undo = (redo = false) => {
    const from = redo ? history.current.future : history.current.past;
    const next = from.pop();
    if (!next || !editable) return;
    (redo ? history.current.past : history.current.future).push(data);
    history.current.expected = JSON.stringify(next);
    onChange?.(next);
    focus(next.nodes.some((item) => item.id === selected) ? selected : root.id);
  };
  const edit = (id = selected, value?: string) => {
    if (!editable) return;
    const target = data.nodes.find((item) => item.id === id);
    if (!target) return;
    editingId.current = id;
    selectName.current = value === undefined;
    setAnchor(null);
    setEditing({ id, value: value ?? target.label });
  };
  const finish = (cancel = false) => {
    if (!editing || editingId.current !== editing.id) return;
    const label = editing.value.trim();
    if (!cancel && !label) {
      setNotice("请输入节点名称。");
      input.current?.focus();
      return;
    }
    editingId.current = null;
    setEditing(null);
    if (
      !cancel &&
      label !== data.nodes.find((item) => item.id === editing.id)?.label
    )
      change({
        ...data,
        nodes: data.nodes.map((item) =>
          item.id === editing.id ? { ...item, label } : item,
        ),
      });
    focus(editing.id);
  };
  const add = (relation: "child" | "sibling", before = false) => {
    if (!editable) return;
    if (data.nodes.length >= MAX_MINDMAP_NODES) {
      setNotice("思维导图最多支持 500 个节点。");
      return;
    }
    const id = crypto.randomUUID();
    const next = addMindmapNode(data, selected, id, relation, before);
    change(next);
    setSelected(id);
    editingId.current = id;
    selectName.current = true;
    setEditing({ id, value: next.nodes.find((item) => item.id === id)!.label });
  };
  const remove = () => {
    if (!editable || node.parentId === null) return;
    change(removeMindmapNode(data, selected));
    focus(node.parentId);
  };
  const toggle = () => {
    if (!hasChildren) return;
    const next = new Set(collapsed);
    if (next.has(selected)) next.delete(selected);
    else next.add(selected);
    if (editable)
      change({
        ...data,
        nodes: data.nodes.map((item) =>
          item.id === selected
            ? { ...item, collapsed: next.has(selected) }
            : item,
        ),
      });
    else setReadingCollapsed(next);
    focus(selected);
  };
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.nativeEvent.isComposing ||
      event.keyCode === 229 ||
      (event.target as Element).closest("input, .sm-view-controls")
    )
      return;
    const command = event.metaKey || event.ctrlKey;
    const menu =
      (event.target as Element).closest(".editor-bubble")?.id === menuId;
    if (menu ? !command : !(event.target as Element).closest(".sm-node"))
      return;
    let handled = true;
    if (command && event.key.toLowerCase() === "z" && editable)
      undo(event.shiftKey);
    else if (command && event.key.toLowerCase() === "y" && editable) undo(true);
    else if (command || event.altKey) handled = false;
    else if (event.key === "Tab" && editable && !event.shiftKey) add("child");
    else if (event.key === "Tab" && editable && event.shiftKey) {
      change(promoteMindmapNode(data, selected));
      focus(selected);
    } else if (event.key === "Enter" && editable)
      add("sibling", event.shiftKey);
    else if (event.key === "F2" && editable) edit();
    else if ((event.key === "Delete" || event.key === "Backspace") && editable)
      remove();
    else if (event.key === " ") toggle();
    else if (event.key === "ArrowLeft") {
      if (node.parentId) focus(node.parentId);
    } else if (event.key === "ArrowRight") {
      if (collapsed.has(selected)) toggle();
      else {
        const child = mindmapChildren(data, selected)[0];
        if (child) focus(child.id);
      }
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const siblings = data.nodes.filter(
        (item) => item.parentId === node.parentId,
      );
      const index = siblings.findIndex((item) => item.id === selected);
      const next = siblings[index + (event.key === "ArrowUp" ? -1 : 1)];
      if (next) focus(next.id);
    } else if (event.key === "Escape") {
      setActive(false);
      (event.target as HTMLElement).blur();
    } else if (event.key.length === 1 && editable) edit(selected, event.key);
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  return (
    <section
      ref={section}
      className="sb-block sm-block"
      aria-label={data.title || "思维导图"}
      contentEditable={false}
      data-editor-keyboard-scope="mindmap"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={keyDown}
      onFocus={() => setActive(true)}
      onBlur={(event) => {
        if (
          !section.current?.contains(event.relatedTarget as Node) &&
          !(event.relatedTarget as Element | null)?.closest?.(
            `[id="${menuId}"]`,
          )
        )
          setActive(false);
      }}
      onContextMenu={() => setActive(false)}
    >
      <BlockHeader
        title={data.title}
        defaultTitle="思维导图"
        description={data.description}
      />
      <div
        ref={viewport}
        className="sm-viewport"
        style={{ height: data.height ?? 460 }}
      >
        <div
          className="sm-scroll-space"
          style={{
            width: graph.width * scale,
            height: graph.height * scale,
            minWidth: "100%",
            minHeight: "100%",
          }}
        >
          <div
            className="sm-map"
            role="tree"
            aria-label="导图节点"
            style={{
              width: graph.width,
              height: graph.height,
              transform: `scale(${scale})`,
              left: `max(0px, calc(50% - ${(graph.width * scale) / 2}px))`,
              top: `max(0px, calc(50% - ${(graph.height * scale) / 2}px))`,
            }}
          >
            <svg
              className="sm-connections"
              width={graph.width}
              height={graph.height}
              aria-hidden="true"
            >
              {graph.nodes
                .filter((item) => item.parentId)
                .map((item) => {
                  const parent = graph.nodes.find(
                    (candidate) => candidate.id === item.parentId,
                  )!;
                  const start = parent.x + (item.side > 0 ? parent.width : 0),
                    end = item.x + (item.side > 0 ? 0 : item.width);
                  const y1 = parent.y + parent.height / 2,
                    y2 = item.y + item.height / 2,
                    middle = (start + end) / 2;
                  return (
                    <path
                      key={item.id}
                      className={`sm-branch-${item.color}`}
                      d={`M ${start} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${end} ${y2}`}
                    />
                  );
                })}
            </svg>
            {graph.nodes.map((item) => {
              const count = mindmapChildren(data, item.id).length;
              const isEditing = editing?.id === item.id;
              return (
                <div
                  key={item.id}
                  className={`sm-node-wrap sm-branch-${item.color}${item.parentId === null ? " sm-root" : ""}`}
                  style={
                    {
                      left: item.x,
                      top: item.y,
                      width: item.width,
                      minHeight: item.height,
                      "--sm-node-height": `${item.height}px`,
                    } as CSSProperties
                  }
                >
                  {isEditing ? (
                    <input
                      ref={input}
                      className="sm-node-input"
                      aria-label="节点名称"
                      maxLength={200}
                      value={editing.value}
                      onChange={(event) =>
                        setEditing({ id: item.id, value: event.target.value })
                      }
                      onBlur={() => finish()}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (
                          event.nativeEvent.isComposing ||
                          event.keyCode === 229
                        )
                          return;
                        if (event.key === "Enter" || event.key === "Tab") {
                          event.preventDefault();
                          finish();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          finish(true);
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      ref={(element) => {
                        if (element) buttons.current.set(item.id, element);
                        else buttons.current.delete(item.id);
                      }}
                      className={`sm-node${active && selected === item.id ? " is-selected" : ""}`}
                      role="treeitem"
                      aria-level={
                        1 +
                        Math.round(Math.abs(item.x - graph.nodes[0].x) / 244)
                      }
                      aria-selected={selected === item.id}
                      aria-expanded={
                        count ? !collapsed.has(item.id) : undefined
                      }
                      tabIndex={selected === item.id ? 0 : -1}
                      onFocus={() => setSelected(item.id)}
                      onClick={(event) => {
                        event.currentTarget.focus({ preventScroll: true });
                        setSelected(item.id);
                        setActive(true);
                      }}
                      onDoubleClick={() => edit(item.id)}
                    >
                      <span>{item.label}</span>
                      {count > 0 && collapsed.has(item.id) && (
                        <span className="sm-count">+{count}</span>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="sm-footer">
        <div
          className="sm-view-controls"
          role="group"
          aria-label="思维导图视图"
        >
          <button
            type="button"
            aria-label="缩小思维导图"
            disabled={scale <= 0.15}
            onClick={() => setScale(Math.max(0.15, scale / 1.2))}
          >
            <Minus size={15} />
          </button>
          <button type="button" aria-label="显示完整思维导图" onClick={fit}>
            <Maximize2 size={15} />
            <span>{Math.round(scale * 100)}%</span>
          </button>
          <button
            type="button"
            aria-label="放大思维导图"
            disabled={scale >= 2}
            onClick={() => setScale(Math.min(2, scale * 1.2))}
          >
            <Plus size={15} />
          </button>
        </div>
        {editable && (
          <details className="sm-help">
            <summary>快捷键</summary>
            <p>
              选中节点后：Tab 子节点 · Enter 同级节点 · Shift+Enter 在前方插入 ·
              Shift+Tab 提升层级 · F2 / 双击 编辑 · 方向键 导航 · 空格 折叠 /
              展开 · Delete 删除分支 · ⌘/Ctrl+Z 撤销 · Shift+⌘/Ctrl+Z 重做 · Esc
              退出。编辑名称时 Enter 保存，Esc 取消。
            </p>
          </details>
        )}
      </div>
      {notice && (
        <p role="status" className="sm-notice">
          {notice}
        </p>
      )}
      {anchor && editable && !editing && (
        <SelectionToolbar
          id={menuId}
          anchor={anchor}
          anchorElement={buttons.current.get(selected)}
          label="思维导图节点操作"
          keyboardScope="mindmap"
          onEscape={() => {
            setActive(false);
            buttons.current.get(selected)?.blur();
          }}
        >
          <button
            className="editor-tool"
            type="button"
            aria-label="编辑节点 F2"
            title="编辑节点 F2"
            onClick={() => edit()}
          >
            <Type size={16} />
          </button>
          <span className="toolbar-divider" />
          <button
            className="editor-tool sm-labeled-action"
            type="button"
            aria-label="新建子节点 Tab"
            title="新建子节点 Tab"
            disabled={data.nodes.length >= MAX_MINDMAP_NODES}
            onClick={() => add("child")}
          >
            <Plus size={16} />
            <span>子节点</span>
          </button>
          <button
            className="editor-tool sm-labeled-action"
            type="button"
            aria-label="新建同级节点 Enter"
            title="新建同级节点 Enter"
            disabled={
              data.nodes.length >= MAX_MINDMAP_NODES || node.parentId === null
            }
            onClick={() => add("sibling")}
          >
            <Plus size={16} />
            <span>同级</span>
          </button>
          <button
            className="editor-tool"
            type="button"
            aria-label={collapsed.has(selected) ? "展开分支" : "折叠分支"}
            title="折叠 / 展开 空格"
            disabled={!hasChildren}
            onClick={toggle}
          >
            <ChevronRight size={16} />
          </button>
          <button
            className="editor-tool"
            type="button"
            aria-label="撤销导图操作"
            title="撤销 ⌘/Ctrl+Z"
            disabled={!history.current.past.length}
            onClick={() => undo()}
          >
            <Undo2 size={16} />
          </button>
          <button
            className="editor-tool"
            type="button"
            aria-label="重做导图操作"
            title="重做 Shift+⌘/Ctrl+Z"
            disabled={!history.current.future.length}
            onClick={() => undo(true)}
          >
            <Redo2 size={16} />
          </button>
          <button
            className="editor-tool"
            type="button"
            aria-label="删除节点及其子节点"
            title="删除分支 Delete"
            disabled={node.parentId === null}
            onClick={remove}
          >
            <Trash2 size={16} />
          </button>
        </SelectionToolbar>
      )}
    </section>
  );
}
