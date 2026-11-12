import type { ShowDocument } from "../types";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/templates";
import { templateHeadings } from "./template-headings";
export default function TemplateOutline({
  document,
}: {
  document: ShowDocument;
}) {
  const t = useTranslator(messages);
  const titles = templateHeadings(document);
  return titles.length ? (
    <ol className="catalog-outline">
      {titles.slice(0, 8).map((title) => (
        <li key={title}>{title}</li>
      ))}
    </ol>
  ) : (
    <p>{document.title || t("pageContent")}</p>
  );
}
