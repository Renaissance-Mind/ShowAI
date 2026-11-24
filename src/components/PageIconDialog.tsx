import { useRef, useState, type ReactNode } from "react";
import PageIcon from "./PageIcon";
import IconImageOptions from "./IconImageOptions";
import { isImageIcon, validatePageIcon } from "../lib/page-icon.mjs";
import Dialog from "../ui/Dialog";
import { errorMessage } from "../host/bridge";
import "./page-icon.css";
import { useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import studioMessages from "../i18n/messages/studio";

export const iconEmoji = [
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

export default function PageIconDialog({
  value,
  onSave,
  onClose,
  title,
  fallback,
}: {
  value: string;
  title?: string;
  fallback?: ReactNode;
  onSave: (value: string) => Promise<void | boolean>;
  onClose: () => void;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const [selected, setSelected] = useState(value);
  const [text, setText] = useState(isImageIcon(value) ? "" : value);
  const [url, setUrl] = useState(/^https?:/i.test(value) ? value : "");
  const [mode, setMode] = useState<"emoji" | "image">(
    isImageIcon(value) ? "image" : "emoji",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const preview =
    isImageIcon(selected) || selected.length <= 64 ? selected : "";
  const canSave = !busy;
  const clearIcon = () => {
    setSelected("");
    setText("");
    setUrl("");
    setError("");
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
      className="page-icon-dialog"
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
          <div className="page-icon-preview-tile">
            <PageIcon value={preview} size={48} fallback={fallback} />
          </div>
        </div>
        <div
          className="page-icon-tabs"
          role="group"
          aria-label={t("icon.mode")}
        >
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
        {mode === "emoji" ? (
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
              {iconEmoji.map((item) => (
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
          <IconImageOptions
            url={url}
            busy={busy}
            onChoose={selectImage}
            onChangeUrl={(next) => {
              setUrl(next);
              setSelected(next.trim());
              setError("");
            }}
          />
        )}
        {error && (
          <p className="studio-error" role="alert">
            {error}
          </p>
        )}
        <footer className="studio-dialog-actions">
          <button
            type="button"
            className="studio-button page-icon-remove"
            disabled={busy || (!value && !selected)}
            onClick={clearIcon}
          >
            {t("icon.remove")}
          </button>
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
