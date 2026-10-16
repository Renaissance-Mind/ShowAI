import { isSafeUrl } from "../portable/validation.mjs";
import { richTextDocument } from "../components/rich-text/model.mjs";

/** Repair editor link marks without dropping their text or relaxing saved-page validation. */
export function repairEditorLinks(document) {
  const repairs = [];
  const visit = (value, path) => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      const next = value.map((item, index) => visit(item, `${path}[${index}]`));
      return next.some((item, index) => item !== value[index]) ? next : value;
    }
    if (
      value.type === "widget" &&
      value.attrs?.kind === "text" &&
      typeof value.attrs.data?.content === "string" &&
      value.attrs.data.format !== "plain"
    ) {
      const parsed = richTextDocument(value.attrs.data);
      const repaired = visit(parsed, `${path}.attrs.data.content`);
      if (repaired !== parsed)
        value = {
          ...value,
          attrs: {
            ...value.attrs,
            data: {
              ...value.attrs.data,
              content: repaired,
              format: "richtext",
            },
          },
        };
    }
    let next = value;
    for (const [key, child] of Object.entries(value)) {
      let updated;
      if (key === "marks" && Array.isArray(child)) {
        updated = child.flatMap((mark, index) => {
          if (mark?.type !== "link" || isSafeUrl(mark.attrs?.href))
            return [mark];
          const raw = mark.attrs?.href;
          let href = typeof raw === "string" ? raw.trim() : "";
          if (href.startsWith("//")) href = "https:" + href;
          else if (/^www\.[^\s/]+\.[^\s]+$/i.test(href))
            href = "https://" + href;
          const safe = isSafeUrl(href);
          repairs.push({
            path: `${path}.marks[${index}]`,
            action: safe ? "normalized" : "unlinked",
          });
          return safe ? [{ ...mark, attrs: { ...mark.attrs, href } }] : [];
        });
        if (
          updated.length === child.length &&
          updated.every((item, index) => item === child[index])
        )
          updated = child;
      } else updated = visit(child, `${path}.${key}`);
      if (updated !== child) {
        if (next === value) next = { ...value };
        if (key === "marks" && !updated.length) delete next.marks;
        else next[key] = updated;
      }
    }
    return next;
  };
  return { document: visit(document, "document"), repairs };
}
