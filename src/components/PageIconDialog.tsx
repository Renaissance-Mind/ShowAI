import { useRef, useState, type ComponentType, type ReactNode } from "react";
import PageIcon from "./PageIcon";
import {
  isImageIcon,
  MAX_ICON_LENGTH,
  validatePageIcon,
} from "../lib/page-icon.mjs";
import Dialog from "../ui/Dialog";
import { Image as ImageIcon, Upload } from "../ui/icons";
import { errorMessage } from "../host/bridge";
import "./page-icon.css";
import { translator } from "../i18n";
import { useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import studioMessages from "../i18n/messages/studio";

const translate = translator(studioMessages);

export type IconPresetPicker = {
  Options: ComponentType<{
    busy: boolean;
    value: string;
    onChoose: (load: () => Promise<string>) => void;
    onDefault: () => void;
  }>;
  Preview: ComponentType<{ value: string }>;
  isPreset: (value: string) => boolean;
};

const emoji = [
  "📄",
  "📚",
  "📝",
  "📊",
  "🧪",
  "🎨",
  "💡",
  "🔬",
  "🌱",
  "🚀",
  "⭐",
  "📌",
  "🎯",
  "🗂️",
  "🏠",
  "💻",
  "🌍",
  "🧠",
  "✨",
  "❤️",
  "🎬",
  "🛠️",
  "📷",
  "🎵",
];

async function readIcon(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type))
    throw new Error(translate("icon.unsupportedType"));
  if (file.size > 8 * 1024 * 1024) throw new Error(translate("icon.tooLarge"));
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(new Error(translate("icon.readCancelled")));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = source;
  await image.decode();
  if (
    Math.max(image.naturalWidth, image.naturalHeight) <= 256 &&
    source.length <= MAX_ICON_LENGTH
  )
    return source;
  const scale = Math.min(
    1,
    256 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export default function PageIconDialog({
  value,
  onSave,
  onClose,
  title,
  fallback,
  presets,
}: {
  value: string;
  title?: string;
  fallback?: ReactNode;
  presets?: IconPresetPicker;
  onSave: (value: string) => Promise<void | boolean>;
  onClose: () => void;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const [selected, setSelected] = useState(value);
  const [text, setText] = useState(isImageIcon(value) ? "" : value);
  const [url, setUrl] = useState(/^https?:/i.test(value) ? value : "");
  const isDefaultChoice = (icon: string) => !icon || !!presets?.isPreset(icon);
  const [mode, setMode] = useState<"default" | "emoji" | "image">(
    presets && isDefaultChoice(value)
      ? "default"
      : isImageIcon(value)
        ? "image"
        : "emoji",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const preview =
    isImageIcon(selected) || selected.length <= 64 ? selected : "";
  const canSave = !busy && (mode !== "default" || isDefaultChoice(selected));
  const clearIcon = () => {
    setSelected("");
    setText("");
    setUrl("");
    setError("");
    if (presets) setMode("default");
  };
  const save = async (next: string) => {
    if (!canSave) return;
    setBusy(true);
    setError("");
    try {
      const saved = await onSave(validatePageIcon(next.trim()));
      if (saved !== false) onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const selectImage = async (load: () => Promise<string>) => {
    const ticket = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await load();
      if (ticket === generation.current) setSelected(result);
    } catch (reason) {
      if (ticket === generation.current) setError(errorMessage(reason));
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  };
  return (
    <Dialog
      title={title ?? t("icon.pageIcon")}
      className={
        presets
          ? "page-icon-dialog page-icon-dialog-with-presets"
          : "page-icon-dialog"
      }
      dismissible={!busy}
      onClose={onClose}
    >
      <form
        className="page-icon-form studio-dialog-body studio-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save(selected);
        }}
      >
        <div className="page-icon-preview" aria-label={t("icon.preview")}>
          {mode === "default" && presets ? (
            <presets.Preview value={preview} />
          ) : (
            <div className="page-icon-preview-tile">
              <PageIcon value={preview} size={48} fallback={fallback} />
            </div>
          )}
        </div>
        <div
          className="page-icon-tabs"
          data-count={presets ? 3 : 2}
          role="group"
          aria-label={t("icon.mode")}
        >
          {presets && (
            <button
              type="button"
              aria-pressed={mode === "default"}
              disabled={busy}
              onClick={() => setMode("default")}
            >
              {t("icon.default")}
            </button>
          )}
          <button
            type="button"
            aria-pressed={mode === "emoji"}
            disabled={busy}
            onClick={() => setMode("emoji")}
          >
            {t("icon.emoji")}
          </button>
          <button
            type="button"
            aria-pressed={mode === "image"}
            disabled={busy}
            onClick={() => setMode("image")}
          >
            {t("icon.image")}
          </button>
        </div>
        {mode === "default" && presets ? (
          <presets.Options
            busy={busy}
            value={selected}
            onChoose={selectImage}
            onDefault={clearIcon}
          />
        ) : mode === "emoji" ? (
          <div className="page-icon-panel">
            <label>
              {t("icon.text")}
              <input
                className="showai-input"
                aria-label={t("icon.text")}
                placeholder={t("icon.textPlaceholder")}
                value={text}
                maxLength={64}
                disabled={busy}
                onChange={(event) => {
                  setText(event.target.value);
                  setSelected(event.target.value);
                  setError("");
                }}
              />
            </label>
            <div className="page-icon-emoji" aria-label={t("icon.common")}>
              {emoji.map((item) => (
                <button
                  type="button"
                  key={item}
                  aria-label={t("icon.use", { icon: item })}
                  aria-pressed={selected === item}
                  disabled={busy}
                  onClick={() => {
                    setSelected(item);
                    setText(item);
                    setError("");
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="page-icon-panel">
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
              hidden
              onChange={(event) => {
                const image = event.target.files?.[0];
                event.target.value = "";
                if (image && !busy) void selectImage(() => readIcon(image));
              }}
            />
            <button
              className="page-icon-upload"
              type="button"
              data-dragging={dragging || undefined}
              disabled={busy}
              onClick={() => file.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const image = event.dataTransfer.files[0];
                if (image && !busy) void selectImage(() => readIcon(image));
              }}
            >
              <span className="page-icon-upload-icon">
                {busy ? <Upload size={22} /> : <ImageIcon size={22} />}
              </span>
              <strong>
                {busy ? t("icon.processing") : t("icon.chooseImage")}
              </strong>
              <small>{t("icon.dropImage")}</small>
            </button>
            <label>
              {t("icon.url")}
              <input
                className="showai-input"
                inputMode="url"
                aria-label={t("icon.urlAria")}
                placeholder="https://…"
                value={url}
                disabled={busy}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setSelected(event.target.value.trim());
                  setError("");
                }}
              />
            </label>
            <p className="page-icon-help">{t("icon.help")}</p>
          </div>
        )}
        {error && (
          <p className="studio-error" role="alert">
            {error}
          </p>
        )}
        <footer className="studio-dialog-actions">
          {mode !== "default" && (
            <button
              type="button"
              className="studio-button page-icon-remove"
              disabled={busy || (!value && !selected)}
              onClick={clearIcon}
            >
              {t("icon.remove")}
            </button>
          )}
          <span />
          <button
            className="studio-button"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            {tc("cancel")}
          </button>
          <button
            className="studio-button primary"
            disabled={!canSave}
            type="submit"
          >
            {tc("save")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
