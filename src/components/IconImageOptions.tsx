import { useRef, useState } from "react";
import { Image as ImageIcon, Upload } from "../ui/icons";
import { MAX_ICON_LENGTH } from "../lib/page-icon.mjs";
import { translator } from "../i18n";
import { useTranslator } from "../i18n/react";
import studioMessages from "../i18n/messages/studio";

const translate = translator(studioMessages);

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

export default function IconImageOptions({
  url,
  busy,
  onChangeUrl,
  onChoose,
}: {
  url: string;
  busy: boolean;
  onChangeUrl: (url: string) => void;
  onChoose: (load: () => Promise<string>) => void;
}) {
  const t = useTranslator(studioMessages);
  const [dragging, setDragging] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const choose = (image?: File) => {
    if (image && !busy) onChoose(() => readIcon(image));
  };
  return (
    <div className="page-icon-panel">
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
        hidden
        onChange={(event) => {
          const image = event.target.files?.[0];
          event.target.value = "";
          choose(image);
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
          choose(event.dataTransfer.files[0]);
        }}
      >
        <span className="page-icon-upload-icon">
          {busy ? <Upload size={22} /> : <ImageIcon size={22} />}
        </span>
        <strong>{busy ? t("icon.processing") : t("icon.chooseImage")}</strong>
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
          onChange={(event) => onChangeUrl(event.target.value)}
        />
      </label>
      <p className="page-icon-help">{t("icon.help")}</p>
    </div>
  );
}
