import { CAPACITY, formatBytes } from "../../portable/capacity.mjs";
import { translator } from "../../i18n";
import messages from "../../i18n/messages/richText";

const t = translator(messages);

/**
 * Reads a pasted, dropped or chosen image the way pages and boards store it:
 * a data URL within the resource limit, or the reason it cannot be used.
 */
export async function readImageFile(
  file: File,
): Promise<{ src: string } | { problem: string }> {
  if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type))
    return { problem: t("notice.imageTypes") };
  if (file.size > CAPACITY.resourceBytes)
    return {
      problem: t("notice.imageTooLarge", {
        name: file.name,
        size: formatBytes(file.size),
        limit: formatBytes(CAPACITY.resourceBytes),
      }),
    };
  const src = await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reader.onabort = () => resolve(null);
    reader.readAsDataURL(file);
  });
  return src === null
    ? { problem: t("notice.imageUnreadable", { name: file.name }) }
    : { src };
}
