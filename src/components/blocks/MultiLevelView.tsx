import {
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { BlockProps } from "./types";
import { ComponentEventBoundary } from "./component-interactions";
import {
  multiLevelPath,
  multiLevelContent,
  multiLevelBindingBlock,
  type MultiLevelView,
  validateMultiLevelViewData,
} from "./multi-level-view-contract.mjs";
import {
  ReaderStateContext,
  useReaderState,
  useReaderStateScope,
} from "../../surface/reader-state";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/multiLevelView";
import { blockLabel } from "./shared";
import { RichTextEnvironment } from "../rich-text/environment";
import { RichTextContent } from "../rich-text/RichTextView";
import "./multi-level-view.css";

type RenderWidget = (props: BlockProps & { kind: string }) => ReactNode;
function LevelContent({
  level,
  choose,
  renderWidget,
}: {
  level: MultiLevelView;
  choose: (id: string) => void;
  renderWidget: RenderWidget;
}) {
  const render = (
    kind: string,
    data: Record<string, unknown>,
    inline?: boolean,
    blockId?: string,
  ) => {
    const bindings = level.bindings.filter(
      (binding) => multiLevelBindingBlock(level, binding) === blockId,
    );
    return (
      <ComponentEventBoundary
        bindings={bindings.map((binding) => ({
          event: binding.event ?? "activate",
          target: binding.source,
          handle: () => {
            choose(binding.to);
            return { status: "handled" };
          },
        }))}
      >
        {renderWidget({ kind, data, readOnly: true, inline })}
      </ComponentEventBoundary>
    );
  };
  return (
    <RichTextContent content={multiLevelContent(level)} renderWidget={render} />
  );
}
export function MultiLevelViewBlock({
  data: raw,
  renderWidget: injected,
}: BlockProps & {
  renderWidget?: RenderWidget;
}) {
  const environment = useContext(RichTextEnvironment);
  const data = useMemo(
    () => validateMultiLevelViewData(raw, environment.validateWidget),
    [raw, environment.validateWidget],
  );
  const levels = useMemo(
    () => new Map(data.levels.map((level) => [level.id, level])),
    [data],
  );
  const [chosen, setChosen] = useReaderState<string>(
    "multi-level-view.level",
    data.root,
    { accept: (value) => typeof value === "string" && levels.has(value) },
  );
  const [direction, setDirection] = useState("in");
  const current = levels.get(chosen) ?? levels.get(data.root)!;
  const path = multiLevelPath(levels, current.id);
  const frame = useRef<HTMLDivElement>(null),
    nav = useRef<HTMLDivElement>(null),
    navigated = useRef(false);
  const scope = useReaderStateScope();
  const t = useTranslator(messages);
  const choose = (id: string | null) => {
    if (!id || !levels.has(id) || id === current.id) return;
    setDirection(
      multiLevelPath(levels, id).length < path.length ? "out" : "in",
    );
    navigated.current = true;
    setChosen(id);
  };
  useEffect(() => {
    if (nav.current) nav.current.scrollLeft = nav.current.scrollWidth;
    if (navigated.current) frame.current?.focus({ preventScroll: true });
  }, [current.id]);

  const childScope = useMemo(
    () =>
      scope
        ? {
            ...scope,
            namespace: JSON.stringify([scope.page, scope.block, current.id]),
          }
        : null,
    [scope, current.id],
  );
  const renderWidget = injected ?? environment.renderWidget;
  return (
    <section
      className="sb-block mlv"
      aria-label={blockLabel(data.title, t("title"))}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !(event.target as HTMLElement).closest("input,textarea") &&
          (event.target as HTMLElement)
            .closest("[contenteditable]")
            ?.getAttribute("contenteditable") !== "true" &&
          current.parentId
        ) {
          event.preventDefault();
          event.stopPropagation();
          choose(current.parentId);
        }
      }}
    >
      <nav className="mlv-nav" aria-label={t("path")}>
        <button
          type="button"
          aria-label={t("back")}
          disabled={current.parentId === null}
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
            <Fragment key={level.id}>
              {index > 0 && <span aria-hidden="true">/</span>}
              {level.id === current.id ? (
                <strong aria-current="location">{level.label}</strong>
              ) : (
                <button type="button" onClick={() => choose(level.id)}>
                  {level.label}
                </button>
              )}
            </Fragment>
          ))}
        </div>
      </nav>
      <div
        ref={frame}
        key={current.id}
        className="mlv-view"
        data-direction={direction}
        tabIndex={-1}
        role="region"
        aria-label={current.label}
      >
        <ReaderStateContext.Provider value={childScope}>
          <LevelContent
            level={current}
            choose={choose}
            renderWidget={renderWidget}
          />
        </ReaderStateContext.Provider>
      </div>
    </section>
  );
}
