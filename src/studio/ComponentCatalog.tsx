import { useEffect, useRef, useState, type RefObject } from "react";
import {
  Blocks,
  PanelsTopLeft,
  ChartNoAxesCombined,
  Code2,
  Image,
  Table2,
  Type,
  Workflow,
} from "../ui/icons";
import type { ComponentCategory } from "../components/custom/types";
import type {
  CatalogComponent,
  ComponentGroup,
} from "../core/component-categories";
import "./component-catalog.css";
import ComponentThumbnail, {
  componentPreviewReference,
} from "./ComponentThumbnail";

const categoryIcons = {
  text: Type,
  image: Image,
  table: Table2,
  data: ChartNoAxesCombined,
  flow: Workflow,
  surface: PanelsTopLeft,
  other: Blocks,
};

export function ComponentNavigation({
  groups,
  active,
  onSelect,
}: {
  groups: ComponentGroup[];
  active: ComponentCategory | null;
  onSelect: (category: ComponentCategory) => void;
}) {
  return (
    <div className="component-type-sidebar">
      <div className="settings-nav-label">类型</div>
      <nav className="settings-nav component-type-nav" aria-label="组件类型">
        {groups.map(({ id, label, items }) => {
          const Icon = categoryIcons[id];
          return (
            <button
              key={id}
              aria-label={label}
              aria-current={active === id ? "location" : undefined}
              disabled={!items.length}
              onClick={() => onSelect(id)}
            >
              <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
              <span className="component-type-count" aria-hidden="true">
                {items.length}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export function ComponentCatalog({
  groups,
  scrollRef,
  request,
  onActiveChange,
  onOpen,
  browser = false,
  showProjectNames = false,
}: {
  groups: ComponentGroup[];
  scrollRef: RefObject<HTMLDivElement | null>;
  request: { category: ComponentCategory; sequence: number } | null;
  onActiveChange: (category: ComponentCategory | null) => void;
  onOpen: (item: CatalogComponent) => void;
  browser?: boolean;
  showProjectNames?: boolean;
}) {
  const catalog = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const sections = useRef(new Map<ComponentCategory, HTMLElement>());
  const destination = useRef<{
    category: ComponentCategory;
    top: number;
    arrived: boolean;
  } | null>(null);
  useEffect(() => {
    const clearSelection = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest('[role="dialog"]'))
        return;
      if (
        catalog.current?.contains(target) &&
        target.closest(".studio-component-card")
      )
        return;
      setSelected(null);
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        catalog.current?.contains(active) &&
        active.closest(".studio-component-card")
      )
        active.blur();
    };
    document.addEventListener("pointerdown", clearSelection, true);
    return () =>
      document.removeEventListener("pointerdown", clearSelection, true);
  }, []);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    destination.current = null;
    let frame = 0;
    const update = () => {
      const target = destination.current;
      if (target) {
        const arrived = Math.abs(scroller.scrollTop - target.top) < 2;
        if (!target.arrived || arrived) {
          target.arrived = arrived;
          onActiveChange(target.category);
          return;
        }
        destination.current = null;
      }
      const visible = groups.filter(({ items }) => items.length);
      if (!visible.length) {
        onActiveChange(null);
        return;
      }
      const top = scroller.getBoundingClientRect().top + 60;
      let current = visible[0].id;
      for (const { id } of visible) {
        const section = sections.current.get(id);
        if (section && section.getBoundingClientRect().top <= top) current = id;
      }
      if (
        scroller.scrollTop > 0 &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
      )
        current = visible[visible.length - 1].id;
      onActiveChange(current);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    scroller.addEventListener("scroll", schedule, { passive: true });
    const cancelJump = () => {
      destination.current = null;
      schedule();
    };
    const keyboardScroll = (event: KeyboardEvent) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        cancelJump();
    };
    scroller.addEventListener("wheel", cancelJump, { passive: true });
    scroller.addEventListener("touchstart", cancelJump, { passive: true });
    scroller.addEventListener("pointerdown", cancelJump, { passive: true });
    scroller.addEventListener("keydown", keyboardScroll);
    const resize = new ResizeObserver(schedule);
    resize.observe(scroller);
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      scroller.removeEventListener("scroll", schedule);
      scroller.removeEventListener("wheel", cancelJump);
      scroller.removeEventListener("touchstart", cancelJump);
      scroller.removeEventListener("pointerdown", cancelJump);
      scroller.removeEventListener("keydown", keyboardScroll);
    };
  }, [groups, scrollRef, onActiveChange]);

  useEffect(() => {
    if (!request) return;
    const scroller = scrollRef.current,
      section = sections.current.get(request.category);
    if (!scroller || !section) return;
    const top = Math.max(
      0,
      Math.min(
        section.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop -
          16,
        scroller.scrollHeight - scroller.clientHeight,
      ),
    );
    destination.current = {
      category: request.category,
      top,
      arrived: Math.abs(scroller.scrollTop - top) < 2,
    };
    onActiveChange(request.category);
    scroller.scrollTo({
      top,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [request, scrollRef, onActiveChange]);

  const visible = groups.filter(({ items }) => items.length);
  return (
    <div className="component-catalog" ref={catalog}>
      {visible.map(({ id, label, items }) => {
        const Icon = categoryIcons[id];
        return (
          <section
            key={id}
            className="component-category"
            aria-label={`${label}组件`}
            ref={(element) => {
              if (element) sections.current.set(id, element);
              else sections.current.delete(id);
            }}
          >
            <header className="component-category-heading">
              <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
              <h2>{label}</h2>
              <span>{items.length}</span>
            </header>
            <div className="studio-component-grid">
              {items.map((item) => {
                const builtin = "kind" in item;
                const key = JSON.stringify(componentPreviewReference(item));
                const scope = builtin
                  ? "内置"
                  : ({
                      builtin: "内置",
                      project: "项目",
                      global: "全局",
                      published: "已发布",
                      user: "全局",
                    }[item.scope] ?? item.scope);
                return (
                  <button
                    className={`studio-component-card${selected === key ? " is-selected" : ""}`}
                    key={
                      builtin
                        ? item.kind
                        : `${item.id}@${item.version}:${item.scope}:${item.projectId ?? ""}:${item.integrity}`
                    }
                    aria-haspopup="dialog"
                    onClick={() => {
                      setSelected(key);
                      onOpen(item);
                    }}
                  >
                    <ComponentThumbnail item={item} browser={browser} />
                    <div className="component-card-copy">
                      <div className="component-card-identity">
                        <span className="studio-component-symbol">
                          {builtin ? (
                            <Icon size={23} strokeWidth={1.6} />
                          ) : (
                            <Code2 size={23} strokeWidth={1.6} />
                          )}
                        </span>
                        <h3>
                          {item.name}
                          <span
                            className="studio-tag"
                            title={!builtin ? item.projectName : undefined}
                          >
                            {showProjectNames && !builtin && item.projectName
                              ? item.projectName
                              : scope}
                          </span>
                        </h3>
                      </div>
                      <p>{item.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      {!visible.length && (
        <div className="studio-empty">
          <Blocks size={33} strokeWidth={1.3} />
          <h2>暂无组件</h2>
          <p>导入本地组件包，或从一个可编辑的示例开始。</p>
        </div>
      )}
    </div>
  );
}
