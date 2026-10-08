import React, { useEffect, useId, useRef, useState } from "react";
import {
  colors,
  framePath,
  geometry,
  initialData,
  makeSvg,
  type IconData,
  type InterfaceMode,
} from "./model";
export { readData } from "./model";

const css = `
.icon-tuner{--it-text:light-dark(#22242a,#f1f1f5);--it-muted:light-dark(#646874,#b7bac6);--it-border:light-dark(#dfe1e7,#40434e);--it-field:light-dark(#fff,#262830);color:var(--it-text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;max-width:820px;margin:0 auto;padding:12px 4px;box-sizing:border-box}
.icon-tuner *{box-sizing:border-box}
.it-previews{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px;max-width:620px;margin:0 auto 24px}
.it-preview{margin:0;min-width:0;text-align:center}
.it-art{display:block;width:100%;max-width:256px;height:auto;margin:0 auto}
.it-caption{margin-top:10px;font-size:14px;color:var(--it-text)}
.it-caption span{display:block;color:var(--it-muted);font-size:12px;margin-top:2px}
.it-color-row{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:16px 0;border-top:1px solid var(--it-border);border-bottom:1px solid var(--it-border)}
.it-color-row>label{font-weight:500;margin-right:4px}
.it-color-input{width:44px;height:38px;padding:3px;border:1px solid var(--it-border);border-radius:7px;background:var(--it-field)}
.it-hex{width:112px;height:38px;border:1px solid var(--it-border);border-radius:7px;background:var(--it-field);color:var(--it-text);padding:6px 10px;font:14px ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase}
.it-button{font:inherit;font-size:13px;color:var(--it-text);background:transparent;border:1px solid var(--it-border);border-radius:7px;padding:7px 12px;min-height:36px;white-space:nowrap}
.it-reset{margin-left:auto}
.it-error{flex-basis:100%;color:light-dark(#b42318,#ff9990);font-size:13px;margin:0}
.it-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 28px;padding:22px 0}
.it-control{min-width:0}
.it-control:last-child:nth-child(odd){grid-column:1/-1}
.it-control-header{display:flex;gap:12px;align-items:baseline;justify-content:space-between;margin-bottom:8px}
.it-control-header label{font-size:14px;font-weight:500}
.it-value{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--it-muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.it-range{display:block;width:100%;min-width:0;margin:0;height:22px;accent-color:var(--it-text)}
.it-hint{margin-top:5px;font-size:12px;color:var(--it-muted)}
.it-output{padding-top:14px;border-top:1px solid var(--it-border);font-size:13px}
.it-output summary{width:fit-content;padding:3px 0;color:var(--it-muted)}
.it-output-tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0 10px}
.it-select{font:inherit;border:1px solid var(--it-border);border-radius:6px;background:var(--it-field);color:var(--it-text);padding:7px 9px;max-width:100%}
.it-source{display:block;width:100%;height:176px;resize:vertical;border:1px solid var(--it-border);border-radius:7px;background:var(--it-field);color:var(--it-text);padding:12px;font:12px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;tab-size:2}
.it-source-note{margin:8px 0 0;color:var(--it-muted);font-size:12px}
@media(max-width:540px){.it-controls{grid-template-columns:1fr;gap:18px}.it-previews{gap:16px}.icon-tuner{padding:8px 0}.it-color-row{gap:9px}.it-reset{margin-left:0}}
@media(pointer:coarse){.it-range{height:36px}.it-button,.it-select,.it-hex,.it-color-input{min-height:44px}.it-hex{font-size:16px}}
`;

function IconPreview({ data, mode }: { data: IconData; mode: InterfaceMode }) {
  const titleId = useId();
  const shape = geometry(data);
  const palette = colors(mode);
  return (
    <figure className="it-preview">
      <svg
        className="it-art"
        viewBox="0 0 512 512"
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>
          {mode === "light" ? "亮色模式：黑底图标" : "暗色模式：白底图标"}
          ，中间颜色 {data.blue}，圆角直径 {data.cornerDiameter}，错位{" "}
          {data.spacing}%，留白 {data.gap}
        </title>
        <path d={framePath} fill={palette.background} />
        {shape.cards.map((card, index) => (
          <rect
            key={card.id}
            data-layer={card.id}
            x={card.x}
            y={card.y}
            width="180"
            height="240"
            rx={shape.cornerRadius}
            fill={card.id === "middle" ? data.blue : palette.foreground}
            stroke={index ? palette.background : undefined}
            strokeWidth={index ? shape.strokeWidth : undefined}
            paintOrder="stroke fill"
          />
        ))}
        <path
          d={framePath}
          fill="none"
          stroke={palette.border}
          strokeWidth="3"
        />
      </svg>
      <figcaption className="it-caption">
        {mode === "light" ? "亮色模式" : "暗色模式"}
        <span>{mode === "light" ? "黑底 · 白色两侧" : "白底 · 黑色两侧"}</span>
      </figcaption>
    </figure>
  );
}

function Slider({
  id,
  label,
  value,
  max,
  min = 0,
  suffix = "",
  hint,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  max: number;
  min?: number;
  suffix?: string;
  hint: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="it-control">
      <div className="it-control-header">
        <label htmlFor={id}>{label}</label>
        <output className="it-value" htmlFor={id}>
          {value}
          {suffix}
        </output>
      </div>
      <input
        className="it-range"
        id={id}
        type="range"
        min={min}
        max={max}
        step="1"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-describedby={`${id}-hint`}
      />
      <div className="it-hint" id={`${id}-hint`}>
        {hint}
      </div>
    </div>
  );
}

export default function IconTuner({
  data,
  onChange,
  readOnly,
}: {
  data: IconData;
  onChange?: (data: IconData) => void;
  readOnly: boolean;
}) {
  const [values, setValues] = useState(data);
  const [hex, setHex] = useState(data.blue);
  const [colorError, setColorError] = useState(false);
  const [outputMode, setOutputMode] = useState<InterfaceMode>("light");
  const sourceField = useRef<HTMLTextAreaElement>(null);
  const current = useRef(values);
  current.current = values;
  const incoming = JSON.stringify(data);
  useEffect(() => {
    setValues(data);
    current.current = data;
    setHex(data.blue);
    setColorError(false);
  }, [incoming]);
  const id = useId();
  const apply = (next: IconData) => {
    current.current = next;
    setValues(next);
    if (!readOnly) onChange?.(next);
  };
  const change = <K extends keyof IconData>(key: K, value: IconData[K]) =>
    apply({ ...current.current, [key]: value });
  const changeColor = (text: string) => {
    setHex(text);
    const normalized = (text.startsWith("#") ? text : `#${text}`).toUpperCase();
    if (/^#[0-9A-F]{6}$/.test(normalized)) {
      change("blue", normalized);
      setColorError(false);
    }
  };

  return (
    <section className="icon-tuner" aria-label="图标调节器">
      <style>{css}</style>
      <div className="it-previews">
        <IconPreview data={values} mode="light" />
        <IconPreview data={values} mode="dark" />
      </div>
      <div className="it-color-row">
        <label htmlFor={`${id}-color`}>蓝色</label>
        <input
          className="it-color-input"
          id={`${id}-color`}
          type="color"
          value={values.blue}
          onChange={(event) => changeColor(event.target.value)}
        />
        <input
          className="it-hex"
          aria-label="蓝色色值"
          value={hex}
          maxLength={7}
          spellCheck={false}
          onChange={(event) => changeColor(event.target.value)}
          onBlur={() => {
            const valid = /^#?[0-9A-Fa-f]{6}$/.test(hex);
            setColorError(!valid);
            if (valid) setHex(current.current.blue);
          }}
          aria-invalid={colorError}
        />
        <button
          className="it-button it-reset"
          type="button"
          onClick={() => {
            apply({ ...initialData });
            setHex(initialData.blue);
            setColorError(false);
          }}
        >
          恢复初始
        </button>
        {colorError && (
          <p className="it-error" role="alert">
            请输入六位色值，例如 #06A5FA。
          </p>
        )}
      </div>
      <div className="it-controls">
        <Slider
          id={`${id}-corner`}
          label="内部圆角直径"
          value={values.cornerDiameter}
          max={180}
          hint="越大越圆，0 为直角。"
          onChange={(value) => change("cornerDiameter", value)}
        />
        <Slider
          id={`${id}-spacing`}
          label="矩形间距"
          value={values.spacing}
          min={60}
          max={160}
          suffix="%"
          hint="以原图为 100%，沿原方向拉开。"
          onChange={(value) => change("spacing", value)}
        />
        <Slider
          id={`${id}-gap`}
          label="层间留白"
          value={values.gap}
          max={24}
          hint="两层交界处的空隙宽度。"
          onChange={(value) => change("gap", value)}
        />
      </div>
      <details className="it-output">
        <summary>SVG 源码</summary>
        <div className="it-output-tools">
          <select
            className="it-select"
            aria-label="SVG 输出版本"
            value={outputMode}
            onChange={(event) =>
              setOutputMode(event.target.value as InterfaceMode)
            }
          >
            <option value="light">亮色模式 · 黑底图标</option>
            <option value="dark">暗色模式 · 白底图标</option>
          </select>
          <button
            className="it-button"
            type="button"
            onClick={() => {
              sourceField.current?.focus();
              sourceField.current?.select();
            }}
          >
            选中源码
          </button>
        </div>
        <textarea
          className="it-source"
          ref={sourceField}
          aria-label="SVG 源码"
          value={makeSvg(values, outputMode)}
          readOnly
          spellCheck={false}
        />
        <p className="it-source-note">选中后按 ⌘C / Ctrl+C 复制。</p>
      </details>
    </section>
  );
}
