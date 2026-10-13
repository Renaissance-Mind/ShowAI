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
  files,
  onChange,
}: {
  bundle: TemplateBundleSource;
  files: Record<string, string>;
  onChange?: (path: string, text: string) => void;
}) {
  const [stage, setStage] = useState<TemplateStage>("intent");
  const parsed = parseTemplateBundle(bundle),
    guide = parsed.guides[stage],
    path = guide?.path;
  const editable = path && onChange && Object.hasOwn(files, path);
  return (
    <div className={`template-workflow-view${onChange ? " is-editing" : ""}`}>
      <section
        className="template-guide-content"
        aria-label={`${templateStageLabels[stage]}指南`}
      >
        {onChange ? (
          <div className="catalog-file-heading">
            <select
              aria-label="指南阶段"
              value={stage}
              onChange={(event) =>
                setStage(event.target.value as TemplateStage)
              }
            >
              {TEMPLATE_STAGES.map((id) => (
                <option key={id} value={id}>
                  {templateStageLabels[id]}
                </option>
              ))}
            </select>
            {path && <span>{path.split("/").at(-1)}</span>}
          </div>
        ) : (
          <header>
            <h3>
              <span className="catalog-stage-number">
                {String(TEMPLATE_STAGES.indexOf(stage) + 1).padStart(2, "0")}
              </span>
              {templateStageLabels[stage]}
            </h3>
          </header>
        )}
        {editable ? (
          <textarea
            aria-label="阶段指南内容"
            className="studio-code-editor"
            value={files[path]}
            onChange={(event) => onChange(path, event.target.value)}
            spellCheck={false}
          />
        ) : guide ? (
          <Widget
            kind="text"
            data={{
              content: parseMarkdown(
                path && Object.hasOwn(files, path)
                  ? files[path]
                  : guide.markdown,
              ),
              format: "richtext",
            }}
            readOnly
          />
        ) : (
          <p>沿用系统呈现规则的{templateStageLabels[stage]}指南。</p>
        )}
      </section>
      {!onChange && (
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
      )}
    </div>
  );
}
