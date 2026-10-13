import { useId, useState } from "react";
import { BuiltinPreview } from "../components/BuiltinPreview";
import { CustomComponentsProvider } from "../components/custom/CustomBlock";
import { componentWidgetData } from "../components/custom/contract";
import type {
  BuiltinComponentMetadata,
  CompiledComponent,
  RelatedPackage,
  TemplateRecord,
} from "../components/custom/types";
import { Widget } from "../components/blocks/Widget";
import { SurfaceReader } from "../portable/SurfaceReader";
import { BookOpen, Sparkles, Layers, Plus } from "../ui/icons";
import type { ShowDocument } from "../types";
import ComponentAdjustmentSummary from "./ComponentAdjustmentSummary";
import ComponentParameterFacts from "./ComponentParameterFacts";
import ComponentParameterSummary from "./ComponentParameterSummary";
import ComponentDocumentationView from "./ComponentDocumentationView";
import TemplateOutline from "./TemplateOutline";
import TemplateWorkflowView from "./TemplateWorkflowView";
import CatalogTabs from "./CatalogTabs";
import CatalogPreview from "./CatalogPreview";
import { errorMessage } from "./bridge";
import Dialog from "./Dialog";
import "./catalog.css";
import "./catalog-workspace.css";

function CompactScenarios({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((item, index) => (
        <li key={index} title={item}>
          {item.split(/[，。]/)[0]}
        </li>
      ))}
    </ul>
  );
}
function ReferenceSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: "usage" | "effect" | "content";
  children: React.ReactNode;
}) {
  const Icon =
    icon === "usage" ? BookOpen : icon === "effect" ? Sparkles : Layers;
  return (
    <section className="catalog-reference-section">
      <h3>
        <Icon size={17} />
        {title}
      </h3>
      {children}
    </section>
  );
}

export type LoadedTemplate = TemplateRecord & {
  components?: CompiledComponent[];
  previewDocument?: ShowDocument;
};
function RelatedList({ items }: { items: RelatedPackage[] }) {
  return items.length ? (
    <ul className="catalog-related">
      {items.map((item, index) => (
        <li key={index}>
          <div>
            <span>{item.kind === "template" ? "模板" : "组件"}</span>
            <code>
              {item.id}
              {item.version ? `@${item.version}` : ""}
            </code>
          </div>
          <p>{item.purpose}</p>
        </li>
      ))}
    </ul>
  ) : (
    <p className="studio-caption">尚未指定。</p>
  );
}
export function TemplateDialog({
  record,
  components,
  onClose,
}: {
  record: LoadedTemplate;
  components: CompiledComponent[];
  onClose: () => void;
}) {
  const panelId = useId();
  const [tab, setTab] = useState<"about" | "guides" | "usage">("about");
  const systemTemplate = record.id === "system-presentation";
  return (
    <Dialog
      title={record.name}
      onClose={onClose}
      wide
      className="catalog-template-dialog"
      titleAccessory={
        <span className="catalog-component-version">v{record.version}</span>
      }
      headerContent={
        <CatalogTabs
          label="模板详情菜单"
          panelId={panelId}
          active={tab}
          onChange={setTab}
          tabs={[
            { id: "about", label: "预览" },
            ...(record.contentGuide?.length || record.examples?.length
              ? [{ id: "usage" as const, label: "使用说明" }]
              : []),
            ...(record.bundle
              ? [{ id: "guides" as const, label: "阶段指南" }]
              : []),
          ]}
        />
      }
    >
      <div
        className="catalog-detail catalog-template-detail"
        role="tabpanel"
        id={panelId}
        aria-label={
          { about: "预览", guides: "阶段指南", usage: "使用说明" }[tab]
        }
      >
        {tab === "guides" && record.bundle && (
          <TemplateWorkflowView bundle={record.bundle} />
        )}
        {tab === "usage" && (
          <article className="catalog-reading-main">
            <p>{record.description}</p>
            {record.contentGuide.map((section, index) => (
              <section key={index}>
                <h3>{section.title}</h3>
                <ul>
                  {section.instructions.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
              </section>
            ))}
            {record.examples.map((example, index) => (
              <section key={index}>
                <h3>{example.name}</h3>
                <p>{example.request}</p>
                <RelatedList items={example.steps} />
              </section>
            ))}
          </article>
        )}
        {tab === "about" && (
          <div className="catalog-preview-workspace">
            <section className="catalog-live-example" aria-label="模板示例预览">
              {systemTemplate ? (
                <div className="catalog-reading-content">
                  <h3>{record.name}</h3>
                  <p>{record.description}</p>
                </div>
              ) : (
                <CatalogPreview
                  label="模板预览画面"
                  width={960}
                  resetKey={record.integrity}
                >
                  <CustomComponentsProvider components={components}>
                    <SurfaceReader
                      document={record.previewDocument ?? record.document}
                      heading={null}
                      partial
                      presentation="spatial"
                    />
                  </CustomComponentsProvider>
                </CatalogPreview>
              )}
            </section>
            <aside className="catalog-info-panel">
              <ReferenceSection title="适用场景" icon="usage">
                <CompactScenarios items={record.scenarios ?? []} />
              </ReferenceSection>
              <ReferenceSection title="页面结构" icon="content">
                <TemplateOutline
                  document={record.previewDocument ?? record.document}
                />
              </ReferenceSection>
              {!!record.related?.length && (
                <details>
                  <summary>相关内容</summary>
                  <RelatedList items={record.related} />
                </details>
              )}
            </aside>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function ComponentDialog({
  builtin,
  custom,
  canInsert,
  onInsert,
  onClose,
}: {
  builtin?: BuiltinComponentMetadata;
  custom?: CompiledComponent;
  canInsert: boolean;
  onInsert: (kind: string, data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const panelId = useId();
  const item = builtin ?? custom!;
  const schema = builtin?.propsSchema ?? custom?.schema ?? {};
  const [tab, setTab] = useState<"about" | "guide" | "schema">("about");
  const [example, setExample] = useState(
    builtin?.kind === "text" && item.examples.length > 1 ? 1 : 0,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const examples = item.examples ?? [];
  const data = examples[example]?.data ?? item.defaultData;
  const insert = async () => {
    setBusy(true);
    setError("");
    try {
      await onInsert(
        builtin?.kind ?? "custom",
        builtin ? structuredClone(data) : componentWidgetData(custom!, data),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={item.name}
      onClose={onClose}
      wide
      className="catalog-component-dialog"
      titleAccessory={
        <span className="catalog-component-version">
          v{item.version ?? "1.0.0"}
        </span>
      }
      headerContent={
        <CatalogTabs
          label="组件详情菜单"
          panelId={panelId}
          active={tab}
          onChange={setTab}
          tabs={[
            { id: "about", label: "预览" },
            { id: "guide", label: "使用说明" },
            { id: "schema", label: "参数" },
          ]}
        />
      }
      headerActions={
        canInsert && (
          <button
            type="button"
            className="studio-text-button"
            disabled={busy}
            onClick={() => void insert()}
          >
            <Plus size={16} />
            插入页面
          </button>
        )
      }
    >
      <div
        className="studio-component-detail catalog-detail"
        role="tabpanel"
        id={panelId}
        aria-label={{ about: "预览", guide: "使用说明", schema: "参数" }[tab]}
      >
        {tab === "guide" && (
          <ComponentDocumentationView documentation={item.documentation} />
        )}
        {tab === "about" && (
          <div className="catalog-preview-workspace">
            <section className="catalog-live-example" aria-label="组件示例预览">
              <CatalogPreview
                label="组件预览画面"
                width={960}
                minHeight={builtin?.kind === "text" ? 620 : undefined}
                resetKey={example}
                accessory={
                  examples.length > 0 && (
                    <select
                      aria-label="组件示例"
                      value={example}
                      onChange={(event) =>
                        setExample(Number(event.target.value))
                      }
                    >
                      {examples.map((value, index) => (
                        <option key={index} value={index}>
                          {value.name}
                        </option>
                      ))}
                    </select>
                  )
                }
              >
                {builtin ? (
                  <BuiltinPreview component={builtin} data={data} />
                ) : (
                  <CustomComponentsProvider components={[custom!]}>
                    <Widget
                      kind="custom"
                      data={componentWidgetData(custom!, data)}
                      readOnly
                    />
                  </CustomComponentsProvider>
                )}
              </CatalogPreview>
            </section>
            <aside className="catalog-info-panel">
              <ReferenceSection title="适用场景" icon="usage">
                <CompactScenarios items={item.scenarios} />
              </ReferenceSection>
              <ReferenceSection title="可调整" icon="effect">
                <ComponentAdjustmentSummary schema={schema} />
              </ReferenceSection>
              <details className="catalog-example-data">
                <summary>示例数据</summary>
                <pre>{JSON.stringify(data, null, 2)}</pre>
              </details>
            </aside>
          </div>
        )}
        {tab === "schema" && (
          <div className="catalog-parameters-workspace">
            <section className="catalog-parameters-main">
              <ComponentParameterSummary
                schema={schema}
                defaults={item.defaultData}
                documentation={item.documentation}
              />
              <details className="catalog-advanced-data">
                <summary>查看原始参数规则与默认数据</summary>
                <h3>参数规则</h3>
                <pre>{JSON.stringify(schema, null, 2)}</pre>
                <h3>默认数据</h3>
                <pre>{JSON.stringify(item.defaultData, null, 2)}</pre>
              </details>
            </section>
            <aside className="catalog-info-panel">
              <ComponentParameterFacts schema={schema} />
            </aside>
          </div>
        )}
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
