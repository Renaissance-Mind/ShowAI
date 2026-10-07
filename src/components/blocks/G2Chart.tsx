import { useEffect, useRef, useState } from "react";
import { BarChart3, Download } from "lucide-react";
import { BlockHeader, Field } from "./shared";
import { GestureBoundary } from "./GestureBoundary";
import { useViewportLock, ViewportLockButton } from "./ViewportLock";
import { downloadFile, text } from "./helpers";
import { createG2Context } from "./g2/engine.js";
import { validateG2Data } from "./g2/contract.mjs";
import licenses from "./g2/licenses.json";
import type { BlockProps } from "./types";
import "./g2-chart.css";

export function G2ChartBlock({
  chartType,
  data,
  onChange,
  readOnly,
}: BlockProps & { chartType: string }) {
  const plot = useRef<HTMLDivElement>(null);
  const lock = useViewportLock("g2");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState("");
  const baseline = useRef("");
  const [exploreTheme, setExploreTheme] = useState<string | null>(null);
  const editable = Boolean(onChange && !readOnly);
  const theme = exploreTheme ?? String(data.theme ?? "indigo");
  const draftValue = (() => {
    if (!editing) return null;
    try {
      const value = JSON.parse(draft);
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, any>)
        : null;
    } catch {
      return null;
    }
  })();
  const draftPalette = Array.isArray(draftValue?.appearance?.palette)
    ? draftValue.appearance.palette
        .slice(0, 20)
        .map((value: unknown) =>
          typeof value === "string" && /^#[a-f\d]{6}$/i.test(value)
            ? value
            : "#888888",
        )
    : ["#120A8F", "#6653CF", "#9A89ED", "#EA8A3B", "#53A7A1"];
  const updateDraft = (next: Record<string, unknown>) => {
    if (!draftValue) {
      setDraftError("请先修正 JSON 格式，再调整设置。");
      return;
    }
    setDraft(JSON.stringify({ ...draftValue, ...next }, null, 2));
    setDraftError("");
  };
  useEffect(() => {
    setExploreTheme(null);
  }, [data.theme]);
  useEffect(() => {
    const target = plot.current;
    if (!target) return;
    let current: ReturnType<typeof createG2Context> | undefined;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    let lastWidth = 0;
    const render = () => {
      if (stopped || target.clientWidth <= 0) return;
      const run = ++generation;
      lastWidth = target.clientWidth;
      current?.destroy();
      target.replaceChildren();
      setReady(false);
      setError("");
      current = createG2Context(
        target,
        chartType,
        { ...data, theme },
        lock.locked,
      );
      current
        .render()
        .then(() => {
          if (!stopped && generation === run) setReady(true);
        })
        .catch((caught) => {
          if (!stopped && generation === run) {
            setError(caught instanceof Error ? caught.message : String(caught));
            setReady(false);
          }
        });
    };
    const observer = new ResizeObserver(() => {
      if (Math.abs(target.clientWidth - lastWidth) < 1) return;
      clearTimeout(timer);
      timer = setTimeout(render, 80);
    });
    observer.observe(target);
    render();
    return () => {
      stopped = true;
      generation++;
      clearTimeout(timer);
      observer.disconnect();
      current?.destroy();
    };
  }, [chartType, data, theme, lock.locked]);
  const open = () => {
    baseline.current = JSON.stringify(data);
    setDraft(JSON.stringify(data, null, 2));
    setDraftError("");
    setEditing(!editing);
  };
  const save = () => {
    if (JSON.stringify(data) !== baseline.current) {
      setDraftError(
        "图表已被其他修改更新。草稿已保留，请关闭设置后重新读取并合并。",
      );
      return;
    }
    let next: Record<string, unknown>;
    try {
      next = JSON.parse(draft);
      validateG2Data(next);
    } catch (caught) {
      setDraftError(
        caught instanceof Error ? caught.message : "数据格式不正确。",
      );
      return;
    }
    onChange?.(next);
    setEditing(false);
    setDraftError("");
  };
  const changeTheme = (next: string) => {
    if (editable) onChange?.({ ...data, theme: next });
    else setExploreTheme(next);
  };
  const exportSvg = () => {
    const svg = plot.current?.querySelector("svg");
    if (!svg) return;
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    downloadFile(
      new XMLSerializer().serializeToString(copy),
      `${chartType}.svg`,
      "image/svg+xml",
    );
  };
  return (
    <section
      ref={lock.ref}
      data-viewport-lock-scope="g2"
      data-viewport-locked={lock.locked}
      className={"sb-block sb-g2-chart" + (theme === "dark" ? " is-dark" : "")}
      aria-label={text(data.title, "G2 图表")}
      data-g2-type={chartType}
      data-third-party-licenses={JSON.stringify(licenses)}
    >
      <BlockHeader
        title={text(data.title, "G2 图表")}
        description={text(data.description)}
        icon={<BarChart3 size={18} />}
        editable={editable}
        editing={editing}
        onEdit={open}
      >
        <button
          type="button"
          className="sb-icon-button"
          aria-label="下载图表 SVG"
          title="下载图表 SVG"
          disabled={!ready}
          onClick={exportSvg}
        >
          <Download size={16} />
        </button>
      </BlockHeader>
      <ViewportLockButton {...lock} label="图表" />
      <div className="sb-g2-toolbar">
        <label>
          主题{" "}
          <select
            aria-label="图表主题"
            value={theme}
            disabled={editing}
            onChange={(e) => changeTheme(e.target.value)}
          >
            <option value="indigo">ShowAI 靛蓝</option>
            <option value="classic">G2 经典</option>
            <option value="dark">深色</option>
          </select>
        </label>
        {editable && <span>数据与样式可在设置中修改</span>}
      </div>
      {editing && (
        <div className="sb-g2-editor">
          {draftValue && (
            <>
              <div className="sb-g2-settings">
                <Field label="标题">
                  <input
                    aria-label="图表标题"
                    value={draftValue.title ?? ""}
                    onChange={(e) => updateDraft({ title: e.target.value })}
                  />
                </Field>
                <Field label="高度">
                  <input
                    aria-label="图表高度"
                    type="number"
                    min={200}
                    max={900}
                    value={draftValue.height ?? 320}
                    onChange={(e) =>
                      updateDraft({ height: Number(e.target.value) })
                    }
                  />
                </Field>
                <Field label="字号">
                  <input
                    aria-label="图表字号"
                    type="number"
                    min={8}
                    max={32}
                    value={draftValue.appearance?.fontSize ?? 12}
                    onChange={(e) =>
                      updateDraft({
                        appearance: {
                          ...draftValue.appearance,
                          fontSize: Number(e.target.value),
                        },
                      })
                    }
                  />
                </Field>
                <Field label="线宽">
                  <input
                    aria-label="图表线宽"
                    type="number"
                    min={0}
                    max={12}
                    step={0.5}
                    value={draftValue.appearance?.lineWidth ?? 2}
                    onChange={(e) =>
                      updateDraft({
                        appearance: {
                          ...draftValue.appearance,
                          lineWidth: Number(e.target.value),
                        },
                      })
                    }
                  />
                </Field>
              </div>
              <div className="sb-g2-palette">
                <span>调色板</span>
                {draftPalette.map((color: string, index: number) => (
                  <input
                    key={index}
                    type="color"
                    aria-label={`图表颜色 ${index + 1}`}
                    value={color}
                    onChange={(e) => {
                      const palette = [...draftPalette];
                      palette[index] = e.target.value;
                      updateDraft({
                        appearance: { ...draftValue.appearance, palette },
                      });
                    }}
                  />
                ))}
              </div>
              <div className="sb-g2-toggles">
                <label>
                  <input
                    type="checkbox"
                    checked={draftValue.legend !== false}
                    onChange={(e) => updateDraft({ legend: e.target.checked })}
                  />
                  显示图例
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(draftValue.animation)}
                    onChange={(e) =>
                      updateDraft({ animation: e.target.checked })
                    }
                  />
                  动画
                </label>
                {Object.entries({
                  tooltip: "悬停提示",
                  elementHighlight: "悬停高亮",
                  elementSelect: "点击选择",
                  brushHighlight: "框选高亮",
                  brushFilter: "框选过滤",
                  legendFilter: "图例筛选",
                }).map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={
                        draftValue.interaction?.[key] ??
                        ["tooltip", "legendFilter"].includes(key)
                      }
                      onChange={(e) =>
                        updateDraft({
                          interaction: {
                            ...draftValue.interaction,
                            [key]: e.target.checked,
                          },
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </>
          )}
          <details className="sb-data-details" open>
            <summary>数据与高级参数</summary>
            <Field label="数据、字段对应及样式参数">
              <textarea
                aria-label="图表参数 JSON"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
              />
            </Field>
            <p>
              datasets 保存数据；fields
              将示例字段对应到自己的字段。高级参数与上方设置同步保存。
            </p>
          </details>
          {draftError && (
            <p role="alert" className="sb-error">
              {draftError}
            </p>
          )}
          <button type="button" className="sb-button" onClick={save}>
            保存图表设置
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="sb-error">
          图表绘制失败：{error}
        </p>
      )}
      <GestureBoundary axes={lock.locked ? [] : ["x", "y", "zoom"]}>
        <div
          ref={plot}
          className="sb-g2-plot"
          style={{ height: Number(data.height ?? 320) }}
          aria-label="图表绘图区"
          aria-busy={!ready && !error}
        />
      </GestureBoundary>
      <details className="sb-data-details">
        <summary>查看原始数据</summary>
        <pre>{JSON.stringify(data.datasets, null, 2)}</pre>
      </details>
    </section>
  );
}
