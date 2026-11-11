import type { MouseEvent } from "react";
import type { BlockProps } from "./types";
import { usePageReferences } from "../page-references";
import { pageLink, requestNavigation } from "../../portable/page-link.mjs";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/pageMention";
import "./page-mention.css";

interface Entry {
  projectId: string;
  pageId: string;
  title: string;
  places: { blockId: string | null; snippet: string }[];
}

/**
 * Pages that refer to this page, each with the text around its reference.
 * It reads references through the public SDK hook, like any component.
 */
export function BacklinksBlock({ data }: BlockProps) {
  const t = useTranslator(messages);
  const references = usePageReferences(
    typeof data.pageId === "string"
      ? {
          direction: "to",
          pageId: data.pageId,
          ...(typeof data.projectId === "string"
            ? { projectId: data.projectId }
            : {}),
        }
      : { direction: "to" },
  );
  const pages: Entry[] = [];
  for (const item of references.items) {
    let page = pages.find(
      (entry) =>
        entry.projectId === item.projectId && entry.pageId === item.pageId,
    );
    if (!page)
      pages.push(
        (page = {
          projectId: item.projectId,
          pageId: item.pageId,
          title: item.title,
          places: [],
        }),
      );
    if (item.snippet || item.blockId)
      page.places.push({ blockId: item.blockId, snippet: item.snippet });
  }
  const follow = (
    event: MouseEvent<HTMLAnchorElement>,
    target: { projectId: string; pageId: string; blockIds: string[] },
  ) => {
    if (requestNavigation(event.currentTarget, target)) event.preventDefault();
  };
  const title = typeof data.title === "string" ? data.title : "";
  return (
    <section
      className="sb-block sb-backlinks"
      aria-label={title || t("backlinks.label")}
      aria-busy={references.status === "loading"}
    >
      {title && <h3 className="sb-backlinks-title">{title}</h3>}
      {references.status === "ready" && !pages.length && (
        <p className="sb-backlinks-empty">{t("backlinks.empty")}</p>
      )}
      {references.status === "unavailable" && (
        <p className="sb-backlinks-empty">
          {references.error ?? t("backlinks.unavailable")}
        </p>
      )}
      {!!pages.length && (
        <ul className="sb-backlinks-pages">
          {pages.map((page) => (
            <li key={`${page.projectId}/${page.pageId}`}>
              <a
                className="sb-backlinks-page"
                href={pageLink(page)}
                onClick={(event) => follow(event, { ...page, blockIds: [] })}
              >
                {page.title || t("backlinks.untitled")}
              </a>
              {page.places.some((place) => place.snippet) && (
                <ul className="sb-backlinks-places">
                  {page.places
                    .filter((place) => place.snippet)
                    .map((place, index) => {
                      const blockIds = place.blockId ? [place.blockId] : [];
                      return (
                        <li key={`${place.blockId}/${index}`}>
                          <a
                            href={pageLink({ ...page, blockIds })}
                            onClick={(event) =>
                              follow(event, { ...page, blockIds })
                            }
                          >
                            {place.snippet}
                          </a>
                        </li>
                      );
                    })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
