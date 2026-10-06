import { BuiltinPreview } from "../components/BuiltinPreview";
import { useState, useId } from "react";
import { useCatalogDraft, CatalogDraftRecovery } from "./useCatalogDraft";
import {
  ArrowDown,
  ArrowUp,
  Globe2,
  BookOpen,
  Monitor,
  Sparkles,
  Layers,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import type { ShowDocument } from "../types";
import type {
  BuiltinComponentMetadata,
  CompiledComponent,
  ComponentMetadata,
  ComponentSource,
  ComponentCategory,
  PackageRevisionRef,
  RelatedPackage,
  TemplateMetadata,
  TemplatePart,
  TemplateRecord,
} from "../components/custom/types";
import { CustomComponentsProvider } from "../components/custom/CustomBlock";
import { componentWidgetData } from "../components/custom/contract";
import { Widget } from "../components/blocks/Widget";
import type { DocumentEditorProps } from "../editor/DocumentEditor";
import SurfaceEditor from "../surface/SurfaceEditor";
import { newDocument } from "../lib/document";
import { desktop, errorMessage } from "./bridge";
import Dialog from "./Dialog";
import {
  componentCategories,
  componentCategory,
} from "../core/component-categories";
import "./catalog.css";

function contentPartDocument(
  document: ShowDocument,
  part: TemplatePart | null,
  content: ShowDocument["content"],
): ShowDocument {
  const {
    layout: _layout,
    views: _views,
    surfaceViews: _surfaceViews,
    ...metadata
  } = document;
  return {
    ...metadata,
    content,
    ...(part?.type === "content"
      ? {
          ...(part.layout ? { layout: part.layout } : {}),
          ...(part.views ? { views: part.views } : {}),
          ...(part.surfaceViews ? { surfaceViews: part.surfaceViews } : {}),
        }
      : {}),
  };
}
function TemplateContent(
  props: DocumentEditorProps & {
    document?: ShowDocument;
    onDocumentChange?: (document: ShowDocument) => void;
  },
) {
  const id = useId();
  const source = props.document ?? {
    ...newDocument(),
    id: `template-${id}`,
    content: props.content,
  };
  return (
    <div className="surface-template">
      <SurfaceEditor
        document={source}
        onChange={(document) =>
          props.onDocumentChange
            ? props.onDocumentChange(document)
            : props.onChange(document.content)
        }
        readOnly={props.readOnly}
      />
    </div>
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
export function blankTemplate(): LoadedTemplate {
  return {
    id: "",
    version: "1.0.0",
    integrity: "",
    name: "",
    description: "",
    scope: "project",
    updatedAt: new Date().toISOString(),
    document: newDocument(),
    scenarios: [],
    contentGuide: [],
    related: [],
    examples: [],
    dependencies: [],
  };
}
const scopeNames: Record<string, string> = {
  project: "项目",
  global: "全局",
  published: "已发布",
  builtin: "内置",
  user: "全局",
};
function nextVersion(version: string) {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : "1.0.0";
}
function lines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
function revision(
  kind: "component" | "template",
  item: ComponentMetadata | TemplateMetadata,
  projectId?: string,
): PackageRevisionRef {
  return {
    kind,
    id: item.id,
    version: item.version,
    integrity: item.integrity,
    scope: item.scope,
    ...(item.scope === "project" && projectId ? { projectId } : {}),
  };
}
function Bullets({ items }: { items: string[] }) {
  return items.length ? (
    <ul>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  ) : (
    <p className="studio-caption">尚未填写。</p>
  );
}
function Lineage({
  item,
}: {
  item: {
    id: string;
    version: string;
    scope: string;
    parents?: PackageRevisionRef[];
  };
}) {
  return (
    <div className="catalog-lineage">
      <span>{scopeNames[item.scope] ?? item.scope}</span>
      <code>
        {item.id}@{item.version}
      </code>
      {!!item.parents?.length && (
        <details>
          <summary>派生来源</summary>
          <ul>
            {item.parents.map((parent) => (
              <li key={`${parent.kind}:${parent.id}:${parent.integrity}`}>
                <code>
                  {parent.id}@{parent.version}
                </code>
                <span>{scopeNames[parent.scope ?? ""] ?? ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
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
function RelatedEditor({
  items,
  onChange,
  label,
}: {
  items: RelatedPackage[];
  onChange: (items: RelatedPackage[]) => void;
  label: string;
}) {
  const patch = (index: number, change: Partial<RelatedPackage>) =>
    onChange(
      items.map((item, i) => (i === index ? { ...item, ...change } : item)),
    );
  return (
    <div className="catalog-related-editor">
      {items.map((item, index) => (
        <div className="catalog-related-row" key={index}>
          <div className="catalog-related-fields">
            <select
              aria-label={`${label} ${index + 1} 类型`}
              value={item.kind}
              onChange={(event) =>
                patch(index, {
                  kind: event.target.value as RelatedPackage["kind"],
                })
              }
            >
              <option value="component">组件</option>
              <option value="template">模板</option>
            </select>
            <input
              aria-label={`${label} ${index + 1} ID`}
              placeholder="ID"
              value={item.id}
              onChange={(event) => patch(index, { id: event.target.value })}
            />
            <input
              aria-label={`${label} ${index + 1} 版本`}
              placeholder="版本（可选）"
              value={item.version ?? ""}
              onChange={(event) =>
                patch(index, { version: event.target.value || undefined })
              }
            />
            <button
              type="button"
              className="studio-icon"
              aria-label={`移除${label} ${index + 1}`}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              <Trash2 size={14} />
            </button>
          </div>
          <input
            aria-label={`${label} ${index + 1} 用途`}
            placeholder="在此处负责什么、如何配合内容呈现"
            value={item.purpose}
            onChange={(event) => patch(index, { purpose: event.target.value })}
          />
        </div>
      ))}
      <button
        className="studio-text-button"
        type="button"
        onClick={() =>
          onChange([...items, { kind: "component", id: "", purpose: "" }])
        }
      >
        <Plus size={14} />
        添加{label}
      </button>
    </div>
  );
}

export function TemplateDialog({
  record,
  components,
  projectId,
  templates,
  onClose,
  onSaved,
  onPublish,
}: {
  record: LoadedTemplate;
  copy?: boolean;
  components: CompiledComponent[];
  projectId?: string;
  templates: TemplateMetadata[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onPublish: (ref: PackageRevisionRef) => void;
}) {
  const [tab, setTab] = useState<"about" | "layout" | "edit" | "composition">(
    record.id ? "about" : "edit",
  );
  const [name, setName] = useState(record.name),
    [description, setDescription] = useState(record.description),
    [version, setVersion] = useState(
      record.integrity ? nextVersion(record.version) : "1.0.0",
    );
  const [document, setDocument] = useState(record.document);
  const [scenarios, setScenarios] = useState(
    (record.scenarios ?? []).join("\n"),
  );
  const [contentGuide, setContentGuide] = useState(record.contentGuide ?? []);
  const [related, setRelated] = useState(record.related ?? []);
  const [examples, setExamples] = useState(record.examples ?? []);
  const [parts, setParts] = useState<TemplatePart[]>(record.composition ?? []);
  const [origin, setOrigin] = useState<PackageRevisionRef | undefined>(
    record.integrity ? revision("template", record, projectId) : undefined,
  );
  const form = {
    name,
    description,
    version,
    document,
    scenarios,
    contentGuide,
    related,
    examples,
    parts,
    origin,
  };
  const localDraft = useCatalogDraft({
    kind: "template",
    projectId,
    resourceId: record.id || "new-template",
    title: name,
    content: form,
    onRestore: (value) => {
      setName(value.name);
      setDescription(value.description);
      setVersion(value.version);
      setDocument(value.document);
      setScenarios(value.scenarios);
      setContentGuide(value.contentGuide);
      setRelated(value.related);
      setExamples(value.examples);
      setParts(value.parts);
      setOrigin(value.origin);
      setTab("edit");
    },
  });
  const [selectedPart, setSelectedPart] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [templateExample, setTemplateExample] = useState(0);
  const [editingPart, setEditingPart] = useState(0);
  const localParts = parts
    .map((part, index) => ({ part, index }))
    .filter((item) => item.part.type === "content");
  const activePartIndex =
    parts[editingPart]?.type === "content"
      ? editingPart
      : (localParts[0]?.index ?? -1);
  const activePart = activePartIndex >= 0 ? parts[activePartIndex] : null;
  const layoutContent =
    activePart?.type === "content"
      ? ["doc", "surface"].includes(activePart.content.type ?? "")
        ? activePart.content
        : { type: "doc", content: [activePart.content] }
      : document.content;
  const run = (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    void operation()
      .catch((reason) => setError(errorMessage(reason)))
      .finally(() => setBusy(false));
  };
  const candidates = templates.filter(
    (item) => item.id !== record.id || item.integrity !== record.integrity,
  );
  const keyOf = (item: TemplateMetadata) =>
    `${item.scope}:${item.id}:${item.version}:${item.integrity}`;
  async function save() {
    if (!projectId)
      throw new Error("先选择一个项目，定制版本会保存在该项目中。");
    const retained = await localDraft.persist(true);
    await desktop.invoke("templates:save", {
      projectId,
      id: record.id || undefined,
      version,
      name,
      description,
      document: { ...document, title: document.title || name },
      scenarios: lines(scenarios),
      contentGuide,
      related,
      examples,
      composition: parts.length ? parts : undefined,
      parents: origin ? [origin] : undefined,
    });
    await localDraft.complete(retained, form);
    await onSaved();
  }
  return (
    <Dialog
      title={record.id ? record.name : "新建模板"}
      onClose={() => void localDraft.close(onClose)}
      wide
    >
      <div className="studio-template-edit catalog-detail">
        <CatalogDraftRecovery draft={localDraft} />
        {!!record.id && <Lineage item={record} />}
        <div className="studio-detail-tabs">
          <button
            className={tab === "about" ? "active" : ""}
            onClick={() => setTab("about")}
          >
            概览
          </button>
          <button
            className={tab === "layout" ? "active" : ""}
            onClick={() => setTab("layout")}
          >
            编辑布局
          </button>
          <button
            className={tab === "edit" ? "active" : ""}
            onClick={() => setTab("edit")}
          >
            定制说明
          </button>
          <button
            className={tab === "composition" ? "active" : ""}
            onClick={() => setTab("composition")}
          >
            组合模板
          </button>
        </div>
        {tab === "about" && (
          <>
            <div className="catalog-reference-intro">
              <span>页面模板 · {record.version}</span>
              <p>{record.description}</p>
            </div>
            <div className="catalog-overview">
              <aside className="catalog-documentation">
                <ReferenceSection title="使用场景" icon="usage">
                  <Bullets items={record.scenarios ?? []} />
                </ReferenceSection>
                <ReferenceSection title="内容处理方式" icon="content">
                  {(record.contentGuide ?? []).map((section, index) => (
                    <div key={index}>
                      <h4>{section.title}</h4>
                      <Bullets items={section.instructions} />
                    </div>
                  ))}
                </ReferenceSection>
                {!!record.related?.length && (
                  <ReferenceSection title="相关模板与组件" icon="content">
                    <RelatedList items={record.related} />
                  </ReferenceSection>
                )}
              </aside>
              <section
                className="catalog-live-example"
                aria-label="模板示例预览"
              >
                <header>
                  <h3>
                    <Monitor size={17} />
                    页面预览
                  </h3>
                  <button
                    className="studio-text-button"
                    onClick={() => setTab("layout")}
                  >
                    编辑布局 ↗
                  </button>
                </header>
                {!!record.examples?.length && (
                  <label className="studio-example-picker">
                    示例
                    <select
                      aria-label="模板示例"
                      value={templateExample}
                      onChange={(event) =>
                        setTemplateExample(Number(event.target.value))
                      }
                    >
                      {record.examples.map((example, index) => (
                        <option key={index} value={index}>
                          {example.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {record.examples?.[templateExample] && (
                  <p className="catalog-example-request">
                    {record.examples[templateExample].request}
                  </p>
                )}
                <div className="catalog-preview-stage catalog-template-preview">
                  <div className="catalog-template-paper">
                    <CustomComponentsProvider components={components}>
                      <TemplateContent
                        content={
                          (record.previewDocument ?? record.document).content
                        }
                        document={record.previewDocument ?? record.document}
                        onChange={() => {}}
                        readOnly
                        minimal
                      />
                    </CustomComponentsProvider>
                  </div>
                </div>
                {!!record.examples?.[templateExample]?.steps.length && (
                  <details className="catalog-example-data">
                    <summary>示例用法</summary>
                    <ol>
                      {record.examples[templateExample].steps.map((step, i) => (
                        <li key={i}>
                          <strong>{step.id}</strong> · {step.purpose}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </section>
            </div>
          </>
        )}
        {tab === "layout" && (
          <>
            <p className="studio-caption">
              {parts.length
                ? "选择要编辑的本地内容部分；引用的子模板保持固定版本。"
                : "内容与布局是应用此模板时的起点。"}
            </p>
            {!!parts.length && !!localParts.length && (
              <label className="studio-example-picker">
                内容部分
                <select
                  aria-label="要编辑的内容部分"
                  value={activePartIndex}
                  onChange={(event) =>
                    setEditingPart(Number(event.target.value))
                  }
                >
                  {localParts.map(({ index }) => (
                    <option key={index} value={index}>
                      第 {index + 1} 部分
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(!parts.length || activePartIndex >= 0) && (
              <div className="studio-template-document">
                <CustomComponentsProvider components={components}>
                  <TemplateContent
                    key={parts.length ? activePartIndex : "document"}
                    content={layoutContent}
                    document={
                      parts.length
                        ? contentPartDocument(
                            document,
                            activePart,
                            layoutContent,
                          )
                        : document
                    }
                    onDocumentChange={(next) => {
                      if (parts.length && activePartIndex >= 0)
                        setParts((current) =>
                          current.map((part, index) =>
                            index === activePartIndex
                              ? {
                                  type: "content",
                                  content: next.content,
                                  layout: next.layout,
                                  ...(next.views ? { views: next.views } : {}),
                                  ...(next.surfaceViews
                                    ? { surfaceViews: next.surfaceViews }
                                    : {}),
                                }
                              : part,
                          ),
                        );
                      else setDocument(next);
                    }}
                    onChange={(content) => {
                      if (parts.length && activePartIndex >= 0)
                        setParts((current) =>
                          current.map((part, index) =>
                            index === activePartIndex
                              ? { type: "content", content }
                              : part,
                          ),
                        );
                      else setDocument((current) => ({ ...current, content }));
                    }}
                    minimal
                    readOnly={!projectId}
                  />
                </CustomComponentsProvider>
              </div>
            )}
            {!!record.composition?.length && record.previewDocument && (
              <details className="catalog-example">
                <summary>查看组合后的完整布局</summary>
                <CustomComponentsProvider components={components}>
                  <TemplateContent
                    content={record.previewDocument.content}
                    document={record.previewDocument}
                    onChange={() => {}}
                    readOnly
                    minimal
                  />
                </CustomComponentsProvider>
              </details>
            )}
          </>
        )}
        {tab === "edit" && (
          <div className="studio-form compact catalog-edit-form">
            <div className="studio-form-row">
              <label>
                名称
                <input
                  aria-label="模板名称"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                新版本
                <input
                  aria-label="模板新版本"
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                />
              </label>
            </div>
            <label>
              简述
              <input
                aria-label="模板简述"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label>
              使用场景（每行一项）
              <textarea
                aria-label="模板使用场景"
                value={scenarios}
                onChange={(event) => setScenarios(event.target.value)}
              />
            </label>
            <section>
              <h3>内容处理方式</h3>
              {contentGuide.map((section, index) => (
                <div className="catalog-guide-editor" key={index}>
                  <div className="catalog-related-fields">
                    <input
                      aria-label={`处理环节 ${index + 1}`}
                      placeholder="环节名称"
                      value={section.title}
                      onChange={(event) =>
                        setContentGuide((current) =>
                          current.map((item, i) =>
                            i === index
                              ? { ...item, title: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <button
                      className="studio-icon"
                      aria-label={`移除处理环节 ${index + 1}`}
                      onClick={() =>
                        setContentGuide((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <textarea
                    aria-label={`处理要求 ${index + 1}`}
                    placeholder="每行一项内容整理与呈现要求"
                    value={section.instructions.join("\n")}
                    onChange={(event) =>
                      setContentGuide((current) =>
                        current.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                instructions: event.target.value.split("\n"),
                              }
                            : item,
                        ),
                      )
                    }
                  />
                </div>
              ))}
              <button
                className="studio-text-button"
                onClick={() =>
                  setContentGuide((current) => [
                    ...current,
                    { title: "", instructions: [] },
                  ])
                }
              >
                <Plus size={14} />
                添加处理环节
              </button>
            </section>
            <section>
              <h3>相关模板与组件</h3>
              <RelatedEditor
                label="关联"
                items={related}
                onChange={setRelated}
              />
            </section>
            <section>
              <h3>示例</h3>
              {examples.map((example, index) => (
                <details className="catalog-example" key={index}>
                  <summary>{example.name || "新示例"}</summary>
                  <label>
                    名称
                    <input
                      aria-label={`模板示例 ${index + 1} 名称`}
                      value={example.name}
                      onChange={(event) =>
                        setExamples((current) =>
                          current.map((item, i) =>
                            i === index
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    需求
                    <textarea
                      aria-label={`模板示例 ${index + 1} 需求`}
                      value={example.request}
                      onChange={(event) =>
                        setExamples((current) =>
                          current.map((item, i) =>
                            i === index
                              ? { ...item, request: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <RelatedEditor
                    label="步骤"
                    items={example.steps}
                    onChange={(steps) =>
                      setExamples((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, steps } : item,
                        ),
                      )
                    }
                  />
                  <button
                    className="studio-text-button"
                    onClick={() =>
                      setExamples((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  >
                    移除此示例
                  </button>
                </details>
              ))}
              <button
                className="studio-text-button"
                onClick={() =>
                  setExamples((current) => [
                    ...current,
                    { name: "", request: "", steps: [] },
                  ])
                }
              >
                <Plus size={14} />
                添加示例
              </button>
            </section>
          </div>
        )}
        {tab === "composition" && (
          <div className="catalog-composition">
            <p className="studio-caption">
              引用精确的模板版本。创建页面时按顺序展开，之后页面可以独立编辑。
            </p>
            {parts.map((part, index) => (
              <div className="catalog-part" key={index}>
                <div>
                  <strong>
                    {part.type === "content"
                      ? "本模板内容"
                      : `${templates.find((item) => item.id === part.ref.id && item.version === part.ref.version && item.integrity === part.ref.integrity)?.name ?? part.ref.id} · ${part.ref.version}`}
                  </strong>
                  {part.type === "template" && (
                    <input
                      aria-label={`组合部分 ${index + 1} 标题`}
                      placeholder="小节标题（可选）"
                      value={part.title ?? ""}
                      onChange={(event) =>
                        setParts((current) =>
                          current.map((item, i) =>
                            i === index
                              ? {
                                  ...part,
                                  title: event.target.value || undefined,
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  )}
                </div>
                <button
                  className="studio-icon"
                  disabled={index === 0}
                  aria-label={`上移组合部分 ${index + 1}`}
                  onClick={() =>
                    setParts((current) => {
                      const copy = [...current];
                      [copy[index - 1], copy[index]] = [
                        copy[index],
                        copy[index - 1],
                      ];
                      return copy;
                    })
                  }
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  className="studio-icon"
                  disabled={index === parts.length - 1}
                  aria-label={`下移组合部分 ${index + 1}`}
                  onClick={() =>
                    setParts((current) => {
                      const copy = [...current];
                      [copy[index], copy[index + 1]] = [
                        copy[index + 1],
                        copy[index],
                      ];
                      return copy;
                    })
                  }
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  className="studio-icon"
                  aria-label={`移除组合部分 ${index + 1}`}
                  onClick={() =>
                    setParts((current) => current.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <div className="catalog-compose-add">
              <select
                aria-label="选择子模板"
                value={selectedPart}
                onChange={(event) => setSelectedPart(event.target.value)}
              >
                <option value="">选择子模板</option>
                {candidates.map((item) => (
                  <option key={keyOf(item)} value={keyOf(item)}>
                    {item.name} · {scopeNames[item.scope]} · {item.version}
                  </option>
                ))}
              </select>
              <button
                className="studio-button"
                disabled={!selectedPart}
                onClick={() => {
                  const target = candidates.find(
                    (item) => keyOf(item) === selectedPart,
                  );
                  if (target)
                    setParts((current) => [
                      ...(current.length
                        ? current
                        : [
                            {
                              type: "content" as const,
                              content: document.content,
                              ...(document.layout
                                ? { layout: document.layout }
                                : {}),
                              ...(document.views
                                ? { views: document.views }
                                : {}),
                              ...(document.surfaceViews
                                ? { surfaceViews: document.surfaceViews }
                                : {}),
                            },
                          ]),
                      {
                        type: "template",
                        ref: revision("template", target, projectId),
                      },
                    ]);
                  setSelectedPart("");
                }}
              >
                添加部分
              </button>
            </div>
            <button
              className="studio-text-button"
              onClick={() => {
                setEditingPart(parts.length);
                setParts((current) => [
                  ...current,
                  {
                    type: "content",
                    content: { type: "doc", content: [{ type: "paragraph" }] },
                  },
                ]);
                setTab("layout");
              }}
            >
              <Plus size={14} />
              添加本地内容部分
            </button>
            {!!parts.length && (
              <button
                className="studio-text-button"
                onClick={() => setParts([])}
              >
                移除所有组合部分
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <span>
            {projectId
              ? "定制保存到当前项目，已有版本保持固定。"
              : "选择项目后可以定制。"}
          </span>
          {record.scope === "project" && !!record.integrity && (
            <button
              className="studio-button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await localDraft.persist();
                  await desktop.invoke("catalog:promote", {
                    ref: revision("template", record, projectId),
                    projectId,
                  });
                  await onSaved();
                })
              }
            >
              <Globe2 size={14} />
              注册到全局
            </button>
          )}
          {record.integrity && (
            <button
              className="studio-button"
              onClick={() =>
                run(async () => {
                  await localDraft.persist();
                  onPublish(revision("template", record, projectId));
                })
              }
            >
              <Upload size={14} />
              发布
            </button>
          )}
          <button
            className="studio-button primary"
            disabled={!projectId || !name.trim() || busy}
            onClick={() => run(save)}
          >
            {busy && <Loader2 size={14} className="studio-spin" />}
            保存项目新版本
          </button>
        </footer>
      </div>
    </Dialog>
  );
}

export function ComponentDialog({
  builtin,
  custom,
  source,
  canInsert,
  projectId,
  onInsert,
  onClose,
  onSaved,
  onPublish,
}: {
  builtin?: BuiltinComponentMetadata;
  custom?: CompiledComponent;
  source?: ComponentSource;
  canInsert: boolean;
  projectId?: string;
  onInsert: (kind: string, data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  onSaved: (component: CompiledComponent) => Promise<void>;
  onPublish: (ref: PackageRevisionRef) => void;
}) {
  const item = builtin ?? custom!;
  const [category, setCategory] = useState<ComponentCategory>(() =>
    componentCategory(item),
  );
  const [tab, setTab] = useState<"about" | "code" | "schema">("about");
  const [code, setCode] = useState(source?.source ?? ""),
    [schema, setSchema] = useState(
      JSON.stringify(
        source?.schema ?? builtin?.propsSchema ?? custom?.schema ?? {},
        null,
        2,
      ),
    ),
    [defaults, setDefaults] = useState(
      JSON.stringify(item.defaultData, null, 2),
    );
  const [examplesJson, setExamplesJson] = useState(
    JSON.stringify(item.examples, null, 2),
  );
  const [name, setName] = useState(item.name),
    [description, setDescription] = useState(item.description),
    [scenarios, setScenarios] = useState(item.scenarios.join("\n")),
    [effects, setEffects] = useState((item.effects ?? []).join("\n"));
  const [version, setVersion] = useState(
    custom ? nextVersion(custom.version) : "1.0.0",
  );
  const [componentId, setComponentId] = useState(
    custom?.id ?? `my-${builtin?.kind}`,
  );
  const [workingSource, setWorkingSource] = useState(source);
  const [origin, setOrigin] = useState<PackageRevisionRef | undefined>(
    custom ? revision("component", custom, projectId) : undefined,
  );
  const form = {
    code,
    schema,
    defaults,
    examplesJson,
    name,
    description,
    scenarios,
    effects,
    version,
    componentId,
    category,
    source: workingSource,
    origin,
  };
  const localDraft = useCatalogDraft({
    kind: "component",
    projectId,
    resourceId: custom?.id ?? `builtin:${builtin?.kind}`,
    title: name,
    content: form,
    enabled: !!source,
    onRestore: (value) => {
      setCode(value.code);
      setSchema(value.schema);
      setDefaults(value.defaults);
      setExamplesJson(value.examplesJson);
      setName(value.name);
      setDescription(value.description);
      setScenarios(value.scenarios);
      setEffects(value.effects);
      setVersion(value.version);
      setComponentId(value.componentId);
      setCategory(value.category);
      setWorkingSource(value.source);
      setOrigin(value.origin);
      setTab("code");
    },
  });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [example, setExample] = useState(0);
  const examples = item.examples ?? [],
    data = examples[example]?.data ?? item.defaultData;
  const run = (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    void operation()
      .catch((reason) => setError(errorMessage(reason)))
      .finally(() => setBusy(false));
  };
  async function save() {
    if (!projectId || !workingSource)
      throw new Error("选择项目并提供组件源码后才能保存定制版本。");
    const retained = await localDraft.persist(true);
    const { mergeBase: _previousMerge, ...baseManifest } =
      workingSource.manifest;
    const saved = await desktop.invoke<CompiledComponent>("components:save", {
      projectId,
      manifest: {
        ...baseManifest,
        id: componentId,
        category,
        name,
        description,
        version,
        scenarios: lines(scenarios),
        effects: lines(effects),
        defaultData: JSON.parse(defaults),
        examples: JSON.parse(examplesJson),
        ...(origin ? { parents: [origin] } : {}),
      },
      schema: JSON.parse(schema),
      source: code,
      files: workingSource.files,
      assets: workingSource.assets,
    });
    await localDraft.complete(retained, form);
    await onSaved(saved);
  }
  return (
    <Dialog
      title={item.name}
      onClose={() => void localDraft.close(onClose)}
      wide
      className="catalog-component-dialog"
      titleAccessory={
        <span className="catalog-component-version">
          {item.version ?? "1.0.0"}
        </span>
      }
      headerContent={
        <nav className="studio-detail-tabs" aria-label="组件详情菜单">
          <button
            className={tab === "about" ? "active" : ""}
            aria-pressed={tab === "about"}
            onClick={() => setTab("about")}
          >
            概览
          </button>
          {source && (
            <button
              className={tab === "code" ? "active" : ""}
              aria-pressed={tab === "code"}
              onClick={() => setTab("code")}
            >
              定制组件
            </button>
          )}
          <button
            className={tab === "schema" ? "active" : ""}
            aria-pressed={tab === "schema"}
            onClick={() => setTab("schema")}
          >
            数据结构
          </button>
        </nav>
      }
    >
      <div className="studio-component-detail catalog-detail">
        <CatalogDraftRecovery draft={localDraft} />
        {custom && <Lineage item={custom} />}
        {tab === "about" && (
          <>
            <div className="catalog-reference-intro">
              <span>{builtin ? "内置组件" : "自定义组件"}</span>
              <p>{item.description}</p>
            </div>
            <div className="catalog-overview">
              <aside className="catalog-documentation">
                <ReferenceSection title="使用场景" icon="usage">
                  <Bullets items={item.scenarios} />
                </ReferenceSection>
                <ReferenceSection title="可视化效果" icon="effect">
                  <Bullets items={item.effects ?? []} />
                </ReferenceSection>
                {source && (
                  <ReferenceSection title="定制起点" icon="content">
                    <p>从这份组件源码保存自己的版本，调整内容、外观与交互。</p>
                    <button
                      className="studio-text-button"
                      onClick={() => setTab("code")}
                    >
                      打开源码 <span aria-hidden="true">↗</span>
                    </button>
                  </ReferenceSection>
                )}
              </aside>
              <section
                className="catalog-live-example"
                aria-label="组件示例预览"
              >
                <header>
                  <h3>
                    <Monitor size={17} />
                    实时示例
                  </h3>
                  <span>可直接体验</span>
                </header>
                {examples.length > 0 && (
                  <label className="studio-example-picker">
                    示例
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
                  </label>
                )}
                {(examples[example]?.request ||
                  examples[example]?.description) && (
                  <p className="catalog-example-request">
                    {examples[example].request ?? examples[example].description}
                  </p>
                )}
                <div className="studio-component-preview catalog-preview-stage">
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
                </div>
                <details className="catalog-example-data">
                  <summary>示例数据</summary>
                  <pre>{JSON.stringify(data, null, 2)}</pre>
                </details>
              </section>
            </div>
          </>
        )}
        {tab === "code" && source && (
          <div className="studio-form catalog-edit-form">
            <label>
              类型
              <select
                aria-label="组件类型"
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as ComponentCategory)
                }
              >
                {componentCategories.map(({ id, label }) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {builtin && (
              <label>
                组件 ID
                <input
                  aria-label="组件 ID"
                  value={componentId}
                  onChange={(event) => setComponentId(event.target.value)}
                />
              </label>
            )}
            <div className="studio-form-row">
              <label>
                名称
                <input
                  aria-label="组件名称"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                新版本
                <input
                  aria-label="组件新版本"
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                />
              </label>
            </div>
            <label>
              简述
              <input
                aria-label="组件说明"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label>
              使用场景（每行一项）
              <textarea
                aria-label="组件使用场景"
                value={scenarios}
                onChange={(event) => setScenarios(event.target.value)}
              />
            </label>
            <label>
              可视化效果（每行一项）
              <textarea
                aria-label="组件效果"
                value={effects}
                onChange={(event) => setEffects(event.target.value)}
              />
            </label>
            <label>
              React / TSX
              <textarea
                className="studio-code-editor"
                aria-label="组件源码"
                spellCheck={false}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
          </div>
        )}
        {tab === "schema" && (
          <div className="studio-form catalog-edit-form">
            <label>
              参数规则
              <textarea
                className="studio-code-editor"
                aria-label="组件参数规则"
                spellCheck={false}
                readOnly={!source}
                value={schema}
                onChange={(event) => setSchema(event.target.value)}
              />
            </label>
            <label>
              默认数据
              <textarea
                className="studio-code-editor short"
                aria-label="组件默认数据"
                spellCheck={false}
                readOnly={!source}
                value={defaults}
                onChange={(event) => setDefaults(event.target.value)}
              />
            </label>
            {source && (
              <label>
                示例（名称、需求、数据）
                <textarea
                  className="studio-code-editor short"
                  aria-label="组件示例数据"
                  value={examplesJson}
                  onChange={(event) => setExamplesJson(event.target.value)}
                />
              </label>
            )}
          </div>
        )}
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          {source && !projectId && <span>选择项目后可定制。</span>}
          {!source && custom && (
            <span>此副本只有运行代码；编辑需要原始源码。</span>
          )}
          {custom?.scope === "project" && (
            <button
              className="studio-button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await localDraft.persist();
                  const result = await desktop.invoke<CompiledComponent>(
                    "catalog:promote",
                    {
                      ref: revision("component", custom, projectId),
                      projectId,
                    },
                  );
                  await onSaved(result);
                })
              }
            >
              <Globe2 size={14} />
              注册到全局
            </button>
          )}
          {custom && (
            <button
              className="studio-button"
              onClick={() =>
                run(async () => {
                  await localDraft.persist();
                  onPublish(revision("component", custom, projectId));
                })
              }
            >
              <Upload size={14} />
              发布
            </button>
          )}
          {source && (tab === "code" || tab === "schema") && (
            <button
              className="studio-button"
              disabled={!projectId || busy}
              onClick={() => run(save)}
            >
              {busy && <Loader2 size={14} className="studio-spin" />}
              保存项目新版本
            </button>
          )}
          <button
            className="studio-button primary"
            disabled={!canInsert}
            onClick={() =>
              run(async () => {
                await localDraft.persist();
                await onInsert(
                  builtin?.kind ?? "custom",
                  builtin
                    ? structuredClone(data)
                    : componentWidgetData(custom!, data),
                );
              })
            }
          >
            <Plus size={15} />
            插入页面
          </button>
        </footer>
      </div>
    </Dialog>
  );
}

export function PublishDialog({
  refValue,
  projectId,
  onClose,
  onPublished,
}: {
  refValue: PackageRevisionRef;
  projectId?: string;
  onClose: () => void;
  onPublished: () => Promise<void>;
}) {
  const [path, setPath] = useState(""),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const run = (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    void operation()
      .catch((reason) => setError(errorMessage(reason)))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog title="发布固定版本" onClose={onClose}>
      <div className="studio-form catalog-edit-form">
        <p className="catalog-publish-intro">
          <code>
            {refValue.id}@{refValue.version}
          </code>
        </p>
        <p>
          生成可部署的静态发布包，放到自己的静态网站后，验证清单地址并登记。登记成功后，网站导出可以引用这个固定版本。
        </p>
        <button
          className="studio-button"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const result = await desktop.invoke<{
                manifestPath: string;
              } | null>("catalog:preparePublish", { ref: refValue, projectId });
              if (result) setPath(result.manifestPath);
            })
          }
        >
          生成发布包
        </button>
        {path && <p className="studio-path">{path}</p>}
        <label>
          已部署的清单地址
          <input
            aria-label="发布清单地址"
            type="url"
            placeholder="https://example.com/showai/manifest.json"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="studio-button" onClick={onClose}>
            关闭
          </button>
          <button
            className="studio-button primary"
            disabled={!url.trim() || busy}
            onClick={() =>
              run(async () => {
                await desktop.invoke("catalog:verifyPublish", {
                  projectId,
                  manifestUrl: url,
                });
                await onPublished();
              })
            }
          >
            {busy && <Loader2 size={14} className="studio-spin" />}验证并登记
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
