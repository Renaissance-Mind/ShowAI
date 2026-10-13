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
export default function TemplateWorkflowView({
  bundle,
}: {
  bundle: TemplateBundleSource;
}) {
  const [stage, setStage] = useState<TemplateStage>("intent");
  const parsed = parseTemplateBundle(bundle),
    guide = parsed.guides[stage];
  return (
    <div className="template-workflow-view">
      <section
        className="template-guide-content"
        aria-label={`${templateStageLabels[stage]}指南`}
      >
        <header>
          <h3>
            <span className="catalog-stage-number">
              {String(TEMPLATE_STAGES.indexOf(stage) + 1).padStart(2, "0")}
            </span>
            {templateStageLabels[stage]}
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
          <p>沿用系统呈现规则的{templateStageLabels[stage]}指南。</p>
        )}
      </section>
      <aside className="catalog-info-panel">
        <h3>阶段</h3>
        <nav className="template-stage-nav" aria-label="模板阶段">
          {TEMPLATE_STAGES.map((id, index) => (
            <button
              key={id}
              aria-pressed={id === stage}
              onClick={() => setStage(id)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {templateStageLabels[id]}
            </button>
          ))}
        </nav>
      </aside>
    </div>
  );
}
