import { useState } from "react";
import {
  parseTemplateBundle,
  type TemplateBundleSource,
} from "../portable/template-bundle.mjs";
import { Widget } from "../components/blocks/Widget";
import { parseMarkdown } from "../lib/markdown";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/templates";

/** A guide's first heading names it; untitled guides fall back to their file. */
function guideTitle({ path, markdown }: { path: string; markdown: string }) {
  return (
    /^#{1,3}\s+(.+)$/m.exec(markdown)?.[1].trim() ??
    path.replace(/^guides\//, "").replace(/\.md$/, "")
  );
}

export default function TemplateWorkflowView({
  bundle,
}: {
  bundle: TemplateBundleSource;
}) {
  const t = useTranslator(messages);
  const [selected, setSelected] = useState(0);
  const { guides } = parseTemplateBundle(bundle);
  const guide = guides[Math.min(selected, guides.length - 1)];
  return (
    <div className="template-workflow-view">
      <section
        className="template-guide-content"
        aria-label={guide ? guideTitle(guide) : t("guides")}
      >
        {guide ? (
          <Widget
            kind="text"
            data={{
              content: parseMarkdown(guide.markdown),
              format: "richtext",
            }}
            readOnly
          />
        ) : (
          <p>{t("noGuides")}</p>
        )}
      </section>
      {guides.length > 1 && (
        <aside className="catalog-info-panel">
          <h3>{t("guides")}</h3>
          <nav className="template-stage-nav" aria-label={t("templateGuides")}>
            {guides.map((item, index) => (
              <button
                key={item.path}
                aria-pressed={item === guide}
                onClick={() => setSelected(index)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {guideTitle(item)}
              </button>
            ))}
          </nav>
        </aside>
      )}
    </div>
  );
}
