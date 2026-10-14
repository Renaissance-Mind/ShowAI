import { useId, useRef, useState, type ReactNode } from "react";
import type { ComponentDocumentation } from "../components/custom/documentation";
import type { ComponentSource } from "../components/custom/types";
import ComponentAuthoringGuides from "./ComponentAuthoringGuides";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/catalog";
const List = ({ items }: { items: string[] }) => (
  <ul>
    {items.map((text, i) => (
      <li key={i}>{text}</li>
    ))}
  </ul>
);
export default function ComponentDocumentationView({
  documentation,
  loadSource,
}: {
  documentation?: ComponentDocumentation;
  loadSource?: () => Promise<ComponentSource>;
}) {
  const t = useTranslator(messages);
  const id = useId(),
    sectionsRef = useRef(new Map<string, HTMLElement>()),
    [active, setActive] = useState("purpose");
  if (!documentation)
    return (
      <div className="catalog-reading-content">
        <p>{t("doc.none")}</p>
      </div>
    );
  const { usage, reuse } = documentation;
  const sections: { id: string; title: string; content: ReactNode }[] = [
    { id: "purpose", title: t("doc.purpose"), content: <p>{usage.purpose}</p> },
    {
      id: "structure",
      title: t("doc.structure"),
      content: <List items={usage.structure} />,
    },
    {
      id: "recipes",
      title: t("doc.recipes"),
      content: usage.recipes.map((recipe) => (
        <details key={recipe.title}>
          <summary>{recipe.title}</summary>
          <List items={recipe.steps} />
        </details>
      )),
    },
    {
      id: "interactions",
      title: t("doc.interactions"),
      content: (
        <table>
          <thead>
            <tr>
              <th>{t("doc.action")}</th>
              <th>{t("doc.result")}</th>
            </tr>
          </thead>
          <tbody>
            {usage.interactions.map((action) => (
              <tr key={action.action}>
                <td>{action.action}</td>
                <td>{action.effect}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    },
    {
      id: "editing",
      title: t("doc.editing"),
      content: <List items={usage.editing.data} />,
    },
    {
      id: "boundaries",
      title: t("doc.boundaries"),
      content: (
        <>
          <List items={reuse.boundaries} />
          <List items={usage.constraints} />
        </>
      ),
    },
  ];
  if (documentation.version === 2 && documentation.authoring)
    sections.push({
      id: "authoring",
      title: "原版制作指南",
      content: (
        <ComponentAuthoringGuides
          entry={documentation.authoring.entry}
          loadSource={loadSource}
        />
      ),
    });
  return (
    <div className="catalog-reading-workspace">
      <article className="catalog-reading-main catalog-component-guide">
        {sections.map((section) => (
          <section
            key={section.id}
            id={`${id}-${section.id}`}
            ref={(element) => {
              if (element) sectionsRef.current.set(section.id, element);
              else sectionsRef.current.delete(section.id);
            }}
          >
            <h3>{section.title}</h3>
            {section.content}
          </section>
        ))}
      </article>
      <aside className="catalog-info-panel catalog-document-index">
        <h3>{t("doc.onThisPage")}</h3>
        {sections.map((section) => (
          <button
            key={section.id}
            aria-current={active === section.id ? "location" : undefined}
            onClick={() => {
              setActive(section.id);
              sectionsRef.current
                .get(section.id)
                ?.scrollIntoView({ block: "start", behavior: "smooth" });
            }}
          >
            {section.title}
          </button>
        ))}
      </aside>
    </div>
  );
}
