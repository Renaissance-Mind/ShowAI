import { useRef, useState, type CSSProperties } from "react";
import { Circle, Folder, Sparkles } from "../ui/icons";
import Dialog from "../ui/Dialog";
import { errorMessage } from "../host/bridge";
import { useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import folderIconMessages from "../i18n/messages/folderIcons";
import studioMessages from "../i18n/messages/studio";
import { isImageIcon, validatePageIcon } from "../lib/page-icon.mjs";
import {
  folderBadgeFill,
  FolderBadgeGlyph,
  FolderIconGlyph,
} from "./FolderIcon";
import IconImageOptions from "./IconImageOptions";
import PageIcon from "./PageIcon";
import { iconEmoji } from "./PageIconDialog";
import {
  defaultFolderColor,
  folderBadgeBackgrounds,
  folderColors,
  folderSymbols,
  rasterizeFolderIcon,
  readFolderIconStyle,
  type FolderBadge,
  type FolderBadgeBackground,
  type FolderIconStyle,
} from "./folder-icon-presets";
import "./folder-icon-dialog.css";

type SelectedIcon = FolderBadge | { kind: "image"; value: string };

export default function FolderIconDialog({
  value,
  title,
  onClose,
  onSave,
}: {
  value: string;
  title: string;
  onClose: () => void;
  onSave: (value: string) => Promise<void | boolean>;
}) {
  const t = useTranslator(folderIconMessages);
  const tc = useTranslator(commonMessages);
  const ts = useTranslator(studioMessages);
  const [initial] = useState(() => readFolderIconStyle(value));
  const [mode, setMode] = useState<FolderIconStyle["mode"]>(
    initial?.mode ?? (value ? "standalone" : "folder"),
  );
  const [color, setColor] = useState(initial?.color ?? "");
  const [badgeBackground, setBadgeBackground] = useState<FolderBadgeBackground>(
    initial?.badgeBackground ?? "transparent",
  );
  const [icon, setIcon] = useState<SelectedIcon | null>(() =>
    initial
      ? initial.badge
      : value
        ? { kind: isImageIcon(value) ? "image" : "emoji", value }
        : null,
  );
  const [source, setSource] = useState<SelectedIcon["kind"]>(
    icon?.kind ?? "symbol",
  );
  const [url, setUrl] = useState(/^https?:\/\//i.test(value) ? value : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preview = useRef<HTMLDivElement>(null);
  const badge: FolderBadge | null =
    icon?.kind === "symbol"
      ? icon
      : icon?.kind === "emoji" && icon.value.trim()
        ? { kind: "emoji", value: icon.value.trim() }
        : null;
  const composition: FolderIconStyle = {
    mode,
    color,
    badge,
    ...(mode === "folder" && badge && badgeBackground !== "transparent"
      ? { badgeBackground }
      : {}),
  };
  const showColor =
    mode === "folder" ||
    icon?.kind === "symbol" ||
    (!icon && source === "symbol");
  const previewColor = (showColor && color) || defaultFolderColor;
  const isCustomColor = !folderColors.some((swatch) => swatch.value === color);
  const canSave =
    !busy &&
    (mode === "folder" ||
      (icon?.kind === "image" ? isImageIcon(icon.value) : !!badge));

  const select = (next: SelectedIcon | null) => {
    setIcon(next);
    setError("");
  };

  const chooseMode = (next: FolderIconStyle["mode"]) => {
    setMode(next);
    if (next === "folder" && source === "image") setSource("symbol");
    if (next === "standalone" && icon?.kind === "image") setSource("image");
    setError("");
  };

  const chooseImage = async (load: () => Promise<string>) => {
    setBusy(true);
    setError("");
    try {
      select({ kind: "image", value: await load() });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError("");
    try {
      let next = "";
      if (mode === "standalone" && icon?.kind !== "symbol") {
        next = validatePageIcon(icon?.value.trim() ?? "");
      } else if (color || badge) {
        if (badge?.kind === "emoji") validatePageIcon(badge.value);
        const state = mode === "folder" ? "closed" : "standalone";
        const glyph = preview.current?.querySelector<SVGSVGElement>(
          `[data-folder-state="${state}"] svg`,
        );
        if (!glyph) throw new Error(ts("icon.preview"));
        next = validatePageIcon(await rasterizeFolderIcon(composition, glyph));
      }
      if ((await onSave(next)) !== false) onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={title}
      className="folder-icon-dialog"
      dismissible={!busy}
      initialFocus="container"
      onClose={onClose}
    >
      <form
        className="studio-dialog-form folder-icon-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="folder-icon-scroll">
          <div className="folder-icon-composer">
            <div className="folder-icon-preview-column">
              <div
                className="folder-icon-modes"
                role="group"
                aria-label={t("mode")}
              >
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={mode === "folder"}
                  onClick={() => chooseMode("folder")}
                >
                  <Folder size={15} aria-hidden="true" />
                  {t("folder")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={mode === "standalone"}
                  onClick={() => chooseMode("standalone")}
                >
                  <Sparkles size={15} aria-hidden="true" />
                  {t("standalone")}
                </button>
              </div>
              <div
                ref={preview}
                className="folder-icon-stage"
                role="group"
                aria-label={ts("icon.preview")}
                style={
                  { "--folder-preview-color": previewColor } as CSSProperties
                }
              >
                {mode === "folder" ? (
                  <>
                    <div
                      data-folder-state="closed"
                      role="img"
                      aria-label={t("closed")}
                    >
                      <FolderIconGlyph composition={composition} size={108} />
                    </div>
                    <div
                      data-folder-state="open"
                      role="img"
                      aria-label={t("open")}
                    >
                      <FolderIconGlyph
                        composition={composition}
                        size={108}
                        open
                      />
                    </div>
                  </>
                ) : (
                  <div data-folder-state="standalone">
                    {icon?.kind === "image" ? (
                      <PageIcon
                        value={isImageIcon(icon.value) ? icon.value : ""}
                        size={100}
                        fallback={<Circle size={44} />}
                      />
                    ) : badge ? (
                      <FolderIconGlyph composition={composition} size={108} />
                    ) : (
                      <Circle size={44} aria-hidden="true" />
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="folder-icon-settings">
              {showColor && (
                <section className="folder-icon-colors">
                  <h3>{t("color")}</h3>
                  <div
                    className="folder-icon-swatches"
                    role="group"
                    aria-label={t("color")}
                  >
                    {folderColors.map((swatch) => (
                      <button
                        key={swatch.value}
                        type="button"
                        title={t(swatch.name)}
                        aria-label={t(swatch.name)}
                        aria-pressed={color === swatch.value}
                        disabled={busy}
                        onClick={() => setColor(swatch.value)}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            background: swatch.value || defaultFolderColor,
                          }}
                        />
                      </button>
                    ))}
                    <label
                      className="folder-icon-custom-color"
                      data-selected={isCustomColor || undefined}
                      title={t("customColor")}
                    >
                      <span aria-hidden="true">
                        {isCustomColor && <i style={{ background: color }} />}
                      </span>
                      <input
                        type="color"
                        aria-label={t("customColor")}
                        value={previewColor}
                        disabled={busy}
                        onInput={(event) => setColor(event.currentTarget.value)}
                      />
                    </label>
                  </div>
                </section>
              )}
              <section className="folder-icon-picker">
                <div className="folder-icon-picker-heading">
                  <h3>{t("icon")}</h3>
                  <div
                    className="folder-icon-sources"
                    role="group"
                    aria-label={t("source")}
                  >
                    <button
                      type="button"
                      disabled={busy}
                      aria-pressed={source === "symbol"}
                      onClick={() => setSource("symbol")}
                    >
                      {t("graphics")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-pressed={source === "emoji"}
                      onClick={() => setSource("emoji")}
                    >
                      {ts("icon.emoji")}
                    </button>
                    {mode === "standalone" && (
                      <button
                        type="button"
                        disabled={busy}
                        aria-pressed={source === "image"}
                        onClick={() => setSource("image")}
                      >
                        {ts("icon.image")}
                      </button>
                    )}
                  </div>
                </div>
                {source === "symbol" ? (
                  <div className="folder-icon-choices">
                    {mode === "folder" && (
                      <button
                        type="button"
                        title={t("none")}
                        aria-label={t("none")}
                        aria-pressed={!badge}
                        disabled={busy}
                        onClick={() => select(null)}
                      >
                        <Circle size={18} aria-hidden="true" />
                      </button>
                    )}
                    {folderSymbols.map((symbol) => {
                      const name = t(`preset.${symbol}`);
                      return (
                        <button
                          key={symbol}
                          type="button"
                          title={name}
                          aria-label={t("useSymbol", { icon: name })}
                          aria-pressed={
                            badge?.kind === "symbol" && badge.value === symbol
                          }
                          disabled={busy}
                          onClick={() =>
                            select({ kind: "symbol", value: symbol })
                          }
                        >
                          <FolderBadgeGlyph
                            badge={{ kind: "symbol", value: symbol }}
                            color="currentColor"
                            size={31}
                          />
                        </button>
                      );
                    })}
                  </div>
                ) : source === "emoji" ? (
                  <div className="folder-icon-emoji">
                    <input
                      className="showai-input"
                      aria-label={ts("icon.text")}
                      placeholder={ts("icon.textPlaceholder")}
                      value={icon?.kind === "emoji" ? icon.value : ""}
                      maxLength={64}
                      disabled={busy}
                      onChange={(event) =>
                        select({ kind: "emoji", value: event.target.value })
                      }
                    />
                    <div className="folder-icon-choices">
                      {iconEmoji.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          aria-label={ts("icon.use", { icon: emoji })}
                          aria-pressed={
                            badge?.kind === "emoji" && badge.value === emoji
                          }
                          disabled={busy}
                          onClick={() =>
                            select({ kind: "emoji", value: emoji })
                          }
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <IconImageOptions
                    url={url}
                    busy={busy}
                    onChoose={chooseImage}
                    onChangeUrl={(next) => {
                      setUrl(next);
                      select({ kind: "image", value: next.trim() });
                    }}
                  />
                )}
              </section>
              {mode === "folder" && badge && (
                <section className="folder-icon-colors">
                  <h3>{t("badgeBackground")}</h3>
                  <div
                    className="folder-icon-swatches folder-icon-badge-backgrounds"
                    role="group"
                    aria-label={t("badgeBackground")}
                  >
                    {folderBadgeBackgrounds.map((background) => {
                      const name = t(`background.${background}`);
                      return (
                        <button
                          key={background}
                          type="button"
                          title={name}
                          aria-label={name}
                          aria-pressed={badgeBackground === background}
                          disabled={busy}
                          onClick={() => setBadgeBackground(background)}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              background: folderBadgeFill(background, color),
                            }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
        {error && (
          <p className="studio-error" role="alert">
            {error}
          </p>
        )}
        <footer className="studio-dialog-actions">
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
            type="submit"
            disabled={!canSave}
          >
            {tc("save")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
