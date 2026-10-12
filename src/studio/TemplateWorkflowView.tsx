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
  const parsed = parseTemplateBundle(bundle);
  const guide = parsed.guides[stage];
  const path = guide?.path;
  return (
    <div className="template-workflow-view">
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
      <section
        className="template-guide-content"
        aria-label={`${templateStageLabels[stage]}指南`}
      >
        <header>
          <h3>{templateStageLabels[stage]}</h3>
          <span>{guide ? "本模板指南" : "沿用系统指南"}</span>
        </header>
        {path && onChange && Object.hasOwn(files, path) ? (
          <label>
            阶段指南（Markdown）
            <textarea
              aria-label="阶段指南内容"
              className="studio-code-editor"
              value={files[path]}
              onChange={(event) => onChange(path, event.target.value)}
              spellCheck={false}
            />
          </label>
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
          <p>
            此阶段采用系统呈现规则。查看“系统呈现规则”模板中的对应阶段指南。
          </p>
        )}
        {path && onChange && !Object.hasOwn(files, path) && (
          <p className="studio-caption">
            此指南由文件夹内的多份说明组成。请在模板源文件目录中编辑各份说明。
          </p>
        )}
      </section>
    </div>
  );
}
