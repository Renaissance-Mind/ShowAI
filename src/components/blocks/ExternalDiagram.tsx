import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Upload } from "../../ui/icons";
import { BlockHeader, Field } from "./shared";
import { BlockSettings } from "./action-host";
import { useViewportLock, ViewportLockButton } from "./ViewportLock";
import { downloadFile, text } from "./helpers";
import {
  diagramDocument,
  diagramLicense,
  diagramSource,
  listDiagramTemplates,
} from "./diagrams/templates";
import {
  diagramLabels,
  replaceDiagramLabels,
  standaloneDiagramSvg,
} from "./diagrams/source-editing";
import {
  validateDiagramData,
  type DiagramFamily,
} from "./diagrams/contract.mjs";
import type { BlockData, BlockProps } from "./types";
import "./external-diagram.css";

const names: Record<DiagramFamily, string> = {
  archify: "Archify 交互架构图",
  "diagram-design": "Diagram Design 图形",
  "fireworks-tech-graph": "Fireworks 技术图",
};

function ExternalDiagramBlock({
  family,
  data,
  onChange,
  readOnly,
}: BlockProps & { family: DiagramFamily }) {
  const templates = useMemo(() => listDiagramTemplates(family), [family]);
  const source = useMemo(() => diagramSource(family, data), [family, data]);
  const html = useMemo(() => diagramDocument(family, source), [family, source]);
  const lock = useViewportLock(`diagram-${family}`);
  const baseline = useRef("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BlockData>({});
  const [labels, setLabels] = useState<string[]>([]);
  const [labelsChanged, setLabelsChanged] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const editable = Boolean(onChange && !readOnly);
  useEffect(() => setReady(false), [html]);

  const readLabels = (value: string) => {
    try {
      setLabels(diagramLabels(value));
      setLabelsChanged(false);
      setError("");
    } catch (caught) {
      setLabels([]);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  const open = () => {
    if (editing) {
      setEditing(false);
      return;
    }
    baseline.current = JSON.stringify(data);
    setDraft({ ...data, source });
    readLabels(source);
    setEditing(true);
  };
  const selectTemplate = (id: string) => {
    if (id === "custom") {
      setDraft((current) => ({ ...current, template: id }));
      return;
    }
    const selected = templates.find((item) => item.id === id)!;
    setDraft((current) => ({
      ...current,
      template: id,
      source: selected.source,
    }));
    readLabels(selected.source);
  };
  const upload = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      setError("请选择 8 MiB 以内的 HTML 或 SVG 文件。");
      return;
    }
    try {
      const imported = await file.text();
      validateDiagramData(family, { template: "custom", source: imported });
      setDraft((current) => ({
        ...current,
        template: "custom",
        source: imported,
      }));
      readLabels(imported);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  const save = () => {
    if (JSON.stringify(data) !== baseline.current) {
      setError("图形已被其他修改更新。草稿已保留，请重新读取并合并后保存。");
      return;
    }
    try {
      const next = {
        ...draft,
        source: labelsChanged
          ? replaceDiagramLabels(text(draft.source), labels)
          : text(draft.source),
      };
      validateDiagramData(family, next);
      diagramLabels(next.source);
      onChange?.(next);
      setEditing(false);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  const exportSvg = () => {
    try {
      const svg = standaloneDiagramSvg(source);
      downloadFile(
        `<!--\n${diagramLicense(family).replaceAll("--", "—")}\n-->${svg}`,
        `${family}.svg`,
        "image/svg+xml",
      );
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <section
      ref={lock.ref}
      className="sb-block sb-external-diagram"
      aria-label={text(data.title, names[family])}
      data-diagram-family={family}
      data-viewport-lock-scope={`diagram-${family}`}
      data-viewport-locked={lock.locked}
      data-diagram-ready={ready}
    >
      <BlockHeader
        title={text(data.title, names[family])}
        defaultTitle={names[family]}
        description={text(data.description)}
        editable={editable}
        editing={editing}
        onEdit={open}
      >
        <button
          type="button"
          className="sb-icon-button"
          aria-label="下载图形 SVG"
          title="下载图形 SVG"
          onClick={exportSvg}
        >
          <Download size={16} />
        </button>
        <button
          type="button"
          className="sb-icon-button"
          aria-label="下载完整图形 HTML"
          title="下载完整图形 HTML"
          onClick={() => downloadFile(html, `${family}.html`, "text/html")}
        >
          HTML
        </button>
      </BlockHeader>
      <ViewportLockButton
        {...lock}
        label="图形"
        unlockDescription="操作图形内的探索、缩放和滚动"
      />
      <iframe
        title={text(data.title, names[family])}
        className="sb-diagram-frame"
        sandbox="allow-scripts allow-downloads"
        referrerPolicy="no-referrer"
        srcDoc={html}
        style={{
          height: Number(data.height ?? 560),
          pointerEvents: lock.locked ? "none" : "auto",
        }}
        tabIndex={lock.locked ? -1 : 0}
        onLoad={() => setReady(true)}
      />
      {error && !editing && (
        <p className="sb-error" role="alert">
          {error}
        </p>
      )}
      {editing && (
        <BlockSettings>
          <div
            className="sb-diagram-editor"
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") setEditing(false);
            }}
          >
            <Field label="模板">
              <select
                aria-label="图形模板"
                value={text(draft.template)}
                onChange={(event) => selectTemplate(event.target.value)}
              >
                {templates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
                <option value="custom">导入或自定义图形</option>
              </select>
            </Field>
            <div className="sb-diagram-fields">
              <Field label="标题">
                <input
                  aria-label="图形标题"
                  value={text(draft.title)}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="高度">
                <input
                  aria-label="图形高度"
                  type="number"
                  min={240}
                  max={1200}
                  value={Number(draft.height ?? 560)}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      height: Number(event.target.value),
                    }))
                  }
                />
              </Field>
            </div>
            <Field label="说明">
              <textarea
                aria-label="图形说明"
                rows={2}
                value={text(draft.description)}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </Field>
            <details className="sb-diagram-labels">
              <summary>图中文字（{labels.length}）</summary>
              <div>
                {labels.map((label, index) => (
                  <Field key={index} label={`文字 ${index + 1}`}>
                    <input
                      aria-label={`图中文字 ${index + 1}`}
                      value={label}
                      onChange={(event) => {
                        setLabels((current) =>
                          current.map((value, i) =>
                            i === index ? event.target.value : value,
                          ),
                        );
                        setLabelsChanged(true);
                      }}
                    />
                  </Field>
                ))}
              </div>
            </details>
            <details>
              <summary>图形源码</summary>
              <textarea
                aria-label="图形源码"
                className="sb-diagram-source"
                rows={12}
                spellCheck={false}
                value={text(draft.source)}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    source: event.target.value,
                  }));
                  setLabels([]);
                  setLabelsChanged(false);
                }}
              />
              <button
                type="button"
                className="sb-button"
                onClick={() => readLabels(text(draft.source))}
              >
                读取图中文字
              </button>
            </details>
            <label className="sb-button sb-diagram-upload">
              <Upload size={14} />
              导入 HTML / SVG
              <input
                type="file"
                aria-label="导入图形文件"
                accept=".html,.htm,.svg,text/html,image/svg+xml"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = "";
                }}
              />
            </label>
            {error && (
              <p className="sb-error" role="alert">
                {error}
              </p>
            )}
            <div className="sb-editor-footer">
              <button type="button" className="sb-button" onClick={save}>
                保存图形
              </button>
              <button
                type="button"
                className="sb-button"
                onClick={() => setEditing(false)}
              >
                取消
              </button>
            </div>
          </div>
        </BlockSettings>
      )}
    </section>
  );
}

export function ArchifyBlock(props: BlockProps) {
  return <ExternalDiagramBlock {...props} family="archify" />;
}
export function DiagramDesignBlock(props: BlockProps) {
  return <ExternalDiagramBlock {...props} family="diagram-design" />;
}
export function FireworksTechGraphBlock(props: BlockProps) {
  return <ExternalDiagramBlock {...props} family="fireworks-tech-graph" />;
}
