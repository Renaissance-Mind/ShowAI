import { useId, useState } from "react";
import { BuiltinPreview } from "../components/BuiltinPreview";
import { CustomComponentsProvider } from "../components/custom/CustomBlock";
import { componentWidgetData } from "../components/custom/contract";
import type {
  BuiltinComponentMetadata,
  CompiledComponent,
  ComponentSource,
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
import TemplateWorkflowView from "./TemplateWorkflowView";
import CatalogTabs from "./CatalogTabs";
import CatalogPreview from "./CatalogPreview";
import { errorMessage } from "./bridge";
import Dialog from "./Dialog";
import { componentDisplayName } from "../components/component-display";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/catalog";
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
  const t = useTranslator(messages);
  return items.length ? (
    <ul className="catalog-related">
      {items.map((item, index) => (
        <li key={index}>
          <div>
            <span>
              {t(item.kind === "template" ? "kind.template" : "kind.component")}
            </span>
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
    <p className="studio-caption">{t("notSpecified")}</p>
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
  const t = useTranslator(messages);
  const panelId = useId();
  const [tab, setTab] = useState<"about" | "guides" | "usage">("about");
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
          label={t("templateDetailsMenu")}
          panelId={panelId}
          active={tab}
          onChange={setTab}
          tabs={[
            {
              id: "about",
              label: t(record.bundle ? "tab.overview" : "tab.preview"),
            },
            ...(record.contentGuide?.length || record.examples?.length
              ? [{ id: "usage" as const, label: t("tab.usage") }]
              : []),
            ...(record.bundle
              ? [{ id: "guides" as const, label: t("tab.guides") }]
              : []),
          ]}
        />
      }
    >
      <div
        className="catalog-detail catalog-template-detail"
        role="tabpanel"
        id={panelId}
        aria-label={t(
          (
            {
              about: record.bundle ? "tab.overview" : "tab.preview",
              guides: "tab.guides",
              usage: "tab.usage",
            } as const
          )[tab],
        )}
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
            <section
              className="catalog-live-example"
              aria-label={t(
                record.bundle ? "tab.overview" : "templateExamplePreview",
              )}
            >
              {record.bundle ? (
                <div className="catalog-reading-content">
                  <h3>{record.name}</h3>
                  <p>{record.description}</p>
                </div>
              ) : (
                <CatalogPreview
                  label={t("templatePreviewCanvas")}
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
              <ReferenceSection title={t("scenarios")} icon="usage">
                <CompactScenarios items={record.scenarios ?? []} />
              </ReferenceSection>
              {!!record.related?.length && (
                <details>
                  <summary>{t("related")}</summary>
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
  loadSource,
}: {
  builtin?: BuiltinComponentMetadata;
  custom?: CompiledComponent;
  canInsert: boolean;
  onInsert: (kind: string, data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  loadSource?: () => Promise<ComponentSource>;
}) {
  const t = useTranslator(messages);
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
      title={componentDisplayName(item)}
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
          label={t("componentDetailsMenu")}
          panelId={panelId}
          active={tab}
          onChange={setTab}
          tabs={[
            { id: "about", label: t("tab.preview") },
            { id: "guide", label: t("tab.usage") },
            { id: "schema", label: t("tab.parameters") },
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
            {t("insertIntoPage")}
          </button>
        )
      }
    >
      <div
        className="studio-component-detail catalog-detail"
        role="tabpanel"
        id={panelId}
        aria-label={t(
          (
            {
              about: "tab.preview",
              guide: "tab.usage",
              schema: "tab.parameters",
            } as const
          )[tab],
        )}
      >
        {tab === "guide" && (
          <ComponentDocumentationView
            documentation={item.documentation}
            loadSource={loadSource}
          />
        )}
        {tab === "about" && (
          <div className="catalog-preview-workspace">
            <section
              className="catalog-live-example"
              aria-label={t("componentExamplePreview")}
            >
              <CatalogPreview
                label={t("componentPreviewCanvas")}
                width={960}
                minHeight={builtin?.kind === "text" ? 620 : undefined}
                resetKey={example}
                accessory={
                  examples.length > 0 && (
                    <select
                      aria-label={t("componentExample")}
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
              <ReferenceSection title={t("scenarios")} icon="usage">
                <CompactScenarios items={item.scenarios} />
              </ReferenceSection>
              <ReferenceSection title={t("adjustable")} icon="effect">
                <ComponentAdjustmentSummary schema={schema} />
              </ReferenceSection>
              <details className="catalog-example-data">
                <summary>{t("exampleData")}</summary>
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
                <summary>{t("rawSchemaAndDefaults")}</summary>
                <h3>{t("parameterRules")}</h3>
                <pre>{JSON.stringify(schema, null, 2)}</pre>
                <h3>{t("defaultData")}</h3>
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
