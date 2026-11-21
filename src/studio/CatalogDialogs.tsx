import { useId, useMemo, useState } from "react";
import { BuiltinPreview } from "../components/BuiltinPreview";
import { CustomComponentsProvider } from "../components/custom/CustomBlock";
import { componentWidgetData, readCustomBlockData } from "../contract/contract";
import type { BlockData } from "../components/blocks/types";
import type {
  BuiltinComponentMetadata,
  CompiledComponent,
  ComponentSource,
  RelatedPackage,
  TemplateRecord,
} from "../contract/types";
import { Widget } from "../components/blocks/Widget";
import { SurfaceReader } from "../portable/SurfaceReader";
import { BookOpen, Sparkles, Layers, Plus, Copy } from "../ui/icons";
import type { ShowDocument } from "../types";
import ComponentAdjustmentSummary from "./ComponentAdjustmentSummary";
import ComponentParameterFacts from "./ComponentParameterFacts";
import ComponentParameterSummary from "./ComponentParameterSummary";
import ComponentDocumentationView from "./ComponentDocumentationView";
import ComponentExampleData from "./ComponentExampleData";
import TemplateWorkflowView from "./TemplateWorkflowView";
import CatalogTabs from "./CatalogTabs";
import CatalogPreview from "./CatalogPreview";
import { errorMessage } from "../host/bridge";
import Dialog from "../ui/Dialog";
import { componentDisplayName } from "../components/component-display";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/catalog";
import { templateAgentPrompt } from "./template-actions";
import managementMessages from "../i18n/messages/catalogManagement";
import {
  PackageActions,
  PackageVersions,
  type ActionStatus,
  type CatalogManager,
} from "./CatalogManagement";
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
  onCreatePage,
  createUnavailable,
  onCopyPrompt,
  manager,
  owner,
}: {
  record: LoadedTemplate;
  components: CompiledComponent[];
  onClose: () => void;
  onCreatePage?: () => Promise<void>;
  createUnavailable?: boolean;
  onCopyPrompt?: (prompt: string) => Promise<void>;
  manager?: CatalogManager;
  owner?: string;
}) {
  const t = useTranslator(messages);
  const tm = useTranslator(managementMessages);
  const panelId = useId();
  const [tab, setTab] = useState<"about" | "guides" | "usage" | "versions">(
    "about",
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    error: boolean;
    text: string;
    prompt?: string;
  } | null>(null);
  const run = async (
    operation: () => Promise<void>,
    done?: string,
    prompt?: string,
  ) => {
    setBusy(true);
    setStatus(null);
    try {
      await operation();
      if (done) setStatus({ error: false, text: done });
    } catch (reason) {
      setStatus({
        error: true,
        text: prompt
          ? t("agentPromptCopyFailed", { reason: errorMessage(reason) })
          : errorMessage(reason),
        prompt,
      });
    } finally {
      setBusy(false);
    }
  };
  const copyPrompt = onCopyPrompt && record.workflow && (
    <button
      type="button"
      className={onCreatePage ? "studio-text-button" : "studio-button primary"}
      disabled={busy}
      onClick={() => {
        const prompt = templateAgentPrompt(record);
        void run(() => onCopyPrompt(prompt), t("agentPromptCopied"), prompt);
      }}
    >
      <Copy size={15} />
      {t("copyAgentPrompt")}
    </button>
  );
  return (
    <Dialog
      title={record.name}
      onClose={onClose}
      wide
      className="catalog-template-dialog"
      titleAccessory={
        <span className="catalog-component-version">v{record.version}</span>
      }
      headerActions={
        (onCreatePage || copyPrompt || manager) && (
          <>
            {createUnavailable && onCreatePage && (
              <span className="catalog-action-reason">
                {t("templateNeedsProject")}
              </span>
            )}
            {copyPrompt}
            {onCreatePage && (
              <button
                type="button"
                className="studio-button primary"
                disabled={busy || createUnavailable}
                title={
                  createUnavailable ? t("templateNeedsProject") : undefined
                }
                onClick={() => void run(onCreatePage)}
              >
                <Plus size={16} />
                {t("useTemplate")}
              </button>
            )}
            {manager && (
              <PackageActions
                kind="template"
                item={record}
                owner={owner}
                manager={manager}
                onStatus={(next: ActionStatus) => setStatus(next)}
              />
            )}
          </>
        )
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
            ...(manager
              ? [{ id: "versions" as const, label: tm("tab.versions") }]
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
          tab === "versions"
            ? tm("tab.versions")
            : t(
                (
                  {
                    about: record.bundle ? "tab.overview" : "tab.preview",
                    guides: "tab.guides",
                    usage: "tab.usage",
                  } as const
                )[tab],
              )
        }
      >
        {status && (
          <p
            className={
              status.error ? "studio-form-error" : "catalog-action-status"
            }
            role={status.error ? "alert" : "status"}
          >
            {status.text}
          </p>
        )}
        {status?.prompt && (
          <textarea
            className="showai-textarea catalog-agent-prompt"
            aria-label={t("copyAgentPrompt")}
            readOnly
            value={status.prompt}
            onFocus={(event) => event.currentTarget.select()}
          />
        )}
        {tab === "guides" && record.bundle && (
          <TemplateWorkflowView bundle={record.bundle} />
        )}
        {tab === "versions" && manager && (
          <PackageVersions
            kind="template"
            item={record}
            owner={owner}
            manager={manager}
          />
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
  insertTarget,
  onClose,
  loadSource,
  manager,
  owner,
}: {
  builtin?: BuiltinComponentMetadata;
  custom?: CompiledComponent;
  insertTarget?: {
    title: string;
    insert: (kind: string, data: BlockData) => Promise<void>;
  };
  onClose: () => void;
  loadSource?: () => Promise<ComponentSource>;
  manager?: CatalogManager;
  owner?: string;
}) {
  const t = useTranslator(messages);
  const tm = useTranslator(managementMessages);
  const panelId = useId();
  const item = builtin ?? custom!;
  const schema = builtin?.propsSchema ?? custom?.schema ?? {};
  const manage = custom ? manager : undefined;
  const [tab, setTab] = useState<"about" | "guide" | "schema" | "versions">(
    "about",
  );
  const [status, setStatus] = useState<ActionStatus>(null);
  const [example, setExample] = useState(
    builtin?.kind === "text" && item.examples.length > 1 ? 1 : 0,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, BlockData>>({});
  const [resetCount, setResetCount] = useState(0);
  const examples = item.examples ?? [];
  const data = drafts[example] ?? examples[example]?.data ?? item.defaultData;
  const widgetData = useMemo(
    () => (custom ? componentWidgetData(custom, data) : data),
    [custom, data],
  );
  const changeExample = (next: BlockData) =>
    setDrafts((current) => ({ ...current, [example]: next }));
  const resetExample = () => {
    setDrafts((current) => {
      const next = { ...current };
      delete next[example];
      return next;
    });
    setResetCount((count) => count + 1);
  };
  const exampleKey = `${example}:${resetCount}`;
  const insert = async () => {
    if (!insertTarget) return;
    setBusy(true);
    setError("");
    try {
      await insertTarget.insert(
        builtin?.kind ?? "custom",
        structuredClone(widgetData),
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
            ...(manage
              ? [{ id: "versions" as const, label: tm("tab.versions") }]
              : []),
          ]}
        />
      }
      headerActions={
        (insertTarget || manage) && (
          <>
            {insertTarget && (
              <button
                type="button"
                className="studio-text-button"
                disabled={busy}
                title={insertTarget.title}
                onClick={() => void insert()}
              >
                <Plus size={16} />
                {t("insertIntoNamedPage", {
                  title:
                    insertTarget.title.length > 14
                      ? `${insertTarget.title.slice(0, 13)}…`
                      : insertTarget.title,
                })}
              </button>
            )}
            {manage && (
              <PackageActions
                kind="component"
                item={custom!}
                owner={owner}
                manager={manage}
                onStatus={setStatus}
              />
            )}
          </>
        )
      }
    >
      <div
        className="studio-component-detail catalog-detail"
        role="tabpanel"
        id={panelId}
        aria-label={
          tab === "versions"
            ? tm("tab.versions")
            : t(
                (
                  {
                    about: "tab.preview",
                    guide: "tab.usage",
                    schema: "tab.parameters",
                  } as const
                )[tab],
              )
        }
      >
        {status && (
          <p
            className={
              status.error ? "studio-form-error" : "catalog-action-status"
            }
            role={status.error ? "alert" : "status"}
          >
            {status.text}
          </p>
        )}
        {tab === "versions" && manage && (
          <PackageVersions
            kind="component"
            item={custom!}
            owner={owner}
            manager={manage}
          />
        )}
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
                resetKey={exampleKey}
                onReset={drafts[example] ? resetExample : undefined}
                accessory={
                  examples.length > 1 && (
                    <select
                      className="showai-select"
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
                  <BuiltinPreview
                    key={exampleKey}
                    component={builtin}
                    data={data}
                    onChange={changeExample}
                  />
                ) : (
                  <CustomComponentsProvider
                    key={exampleKey}
                    components={[custom!]}
                  >
                    <Widget
                      kind="custom"
                      data={widgetData}
                      onChange={(next) =>
                        changeExample(readCustomBlockData(next).props)
                      }
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
              <ComponentExampleData
                key={exampleKey}
                builtin={builtin}
                data={data}
                onChange={changeExample}
              />
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
