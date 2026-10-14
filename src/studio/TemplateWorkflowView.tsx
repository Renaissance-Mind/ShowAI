import { useState } from "react";
import {
  parseTemplateBundle,
  TEMPLATE_STAGES,
  type TemplateBundleSource,
  type TemplateStage,
} from "../portable/template-bundle.mjs";
import { Widget } from "../components/blocks/Widget";
import { parseMarkdown } from "../lib/markdown";
import { templateStageLabels } from "./template-catalog-model";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/templates";
export default function TemplateWorkflowView({
  bundle,
}: {
  bundle: TemplateBundleSource;
}) {
  const t = useTranslator(messages);
  const [stage, setStage] = useState<TemplateStage>("intent");
  const stageLabel = t(templateStageLabels[stage]);
  const parsed = parseTemplateBundle(bundle),
    guide = parsed.guides[stage];
  return (
    <div className="template-workflow-view">
      <section
        className="template-guide-content"
        aria-label={t("stageGuide", { stage: stageLabel })}
      >
        <header>
          <h3>
            <span className="catalog-stage-number">
              {String(TEMPLATE_STAGES.indexOf(stage) + 1).padStart(2, "0")}
            </span>
            {stageLabel}
          </h3>
        </header>
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
          <p>{t("stageGuideFallback", { stage: stageLabel })}</p>
        )}
      </section>
      <aside className="catalog-info-panel">
        <h3>{t("stages")}</h3>
        <nav className="template-stage-nav" aria-label={t("templateStages")}>
          {TEMPLATE_STAGES.map((id, index) => (
            <button
              key={id}
              aria-pressed={id === stage}
              onClick={() => setStage(id)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {t(templateStageLabels[id])}
            </button>
          ))}
        </nav>
      </aside>
    </div>
  );
}
