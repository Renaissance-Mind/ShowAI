import { useState } from "react";
import { Check, Upload } from "../../ui/icons";
import { Field } from "./shared";
import {
  fileMime,
  MAX_UPLOAD_BYTES,
  validateResearchData,
} from "./research-contract.mjs";
import { text } from "./helpers";
import type { BlockData } from "./types";

export function ResourceEditor({
  kind,
  data,
  onSave,
  onClose,
}: {
  kind: "video" | "audio" | "pdf";
  data: BlockData;
  onSave: (next: BlockData) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(data);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const set = (key: string, value: unknown) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const upload = async (file: File) => {
    setError("");
    const mime = fileMime(kind, file);
    if (!mime) {
      setError("请选择对应类型的文件。");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        "单个文件最多 6 MB；较大的媒体可以填写在线文件地址。整页保存上限为 10 MB。",
      );
      return;
    }
    setLoading(true);
    try {
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          resolve(
            String(reader.result).replace(
              /^data:[^;,]*;base64,/,
              `data:${mime};base64,`,
            ),
          );
        reader.onerror = () =>
          reject(reader.error ?? new Error("文件读取失败。"));
        reader.readAsDataURL(file);
      });
      setDraft((current) => ({
        ...current,
        src: encoded,
        fileName: file.name,
      }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "文件读取失败。");
    } finally {
      setLoading(false);
    }
  };
  const save = () => {
    try {
      validateResearchData(kind, draft);
      onSave(draft);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "文件设置不正确。");
    }
  };
  return (
    <div
      className="sb-editor-panel"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="sb-resource-source">
        <label className="sb-button sb-resource-upload">
          <Upload size={14} />
          {loading ? "读取文件…" : "选择本地文件"}
          <input
            type="file"
            aria-label="选择本地文件"
            disabled={loading}
            accept={kind === "pdf" ? ".pdf,application/pdf" : `${kind}/*`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
        </label>
        {text(draft.fileName) && (
          <span className="sb-resource-file-name">{text(draft.fileName)}</span>
        )}
      </div>
      <Field label="在线文件地址">
        <input
          type="url"
          placeholder="https://…"
          value={text(draft.src).startsWith("data:") ? "" : text(draft.src)}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              src: event.target.value,
              fileName: "",
            }))
          }
        />
      </Field>
      <Field label="标题">
        <input
          value={text(draft.title)}
          onChange={(event) => set("title", event.target.value)}
        />
      </Field>
      <Field label="说明">
        <textarea
          rows={2}
          value={text(draft.caption)}
          onChange={(event) => set("caption", event.target.value)}
        />
      </Field>
      {kind === "video" && (
        <>
          <Field label="画面比例">
            <select
              value={text(draft.aspectRatio, "16:9")}
              onChange={(event) => set("aspectRatio", event.target.value)}
            >
              {["16:9", "4:3", "1:1", "9:16"].map((ratio) => (
                <option key={ratio}>{ratio}</option>
              ))}
            </select>
          </Field>
          <Field label="封面图片地址">
            <input
              value={text(draft.poster)}
              onChange={(event) => set("poster", event.target.value)}
            />
          </Field>
        </>
      )}
      {kind === "pdf" && (
        <div className="sb-resource-fields">
          <Field label="初始页码">
            <input
              type="number"
              min={1}
              value={Number(draft.page ?? 1)}
              onChange={(event) => set("page", event.target.valueAsNumber)}
            />
          </Field>
          <Field label="阅读区高度">
            <input
              type="number"
              min={240}
              max={1200}
              value={Number(draft.height ?? 560)}
              onChange={(event) => set("height", event.target.valueAsNumber)}
            />
          </Field>
        </div>
      )}
      <p className="sb-resource-hint">
        本地文件随页面保存；在线地址需要网络。上传单文件最多 6 MB，整页最多 10
        MB。
      </p>
      {error && (
        <p className="sb-error" role="alert">
          {error}
        </p>
      )}
      <div className="sb-panel-footer">
        <button
          className="sb-button sb-primary"
          type="button"
          disabled={loading}
          onClick={save}
        >
          <Check size={14} />
          保存
        </button>
      </div>
    </div>
  );
}
