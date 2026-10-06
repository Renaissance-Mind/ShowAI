import { MAX_ARTIFACT_BYTES } from "../portable/validation.mjs";
import { Widget } from "../components/blocks/Widget";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { JSONContent } from "@tiptap/core";
import { Undo2, X } from "lucide-react";
import DocumentEditor from "../editor/DocumentEditor";
import type { ShowDocument } from "../types";
import type { NodeLayout } from "./types";
import PageSurface, { type SurfaceHandle } from "./PageSurface";
import {
  SurfaceContent,
  nodeName,
  type ContentRenderProps,
} from "./SurfaceContent";
import {
  isSurface,
  nodePaths,
  findSurfaceNode,
  orderedSurfaceNodes,
  reconcileSurface,
  upgradeDocument,
} from "./document.mjs";
import {
  captureDeletion,
  restoreDeletion,
  type DeletedNode,
  addNode,
  createRegion,
  detachBlock,
  editNode,
  moveNode,
  regionOptions,
  removeNode,
  replaceChildren,
} from "./editing";

const RichEditor = memo(function RichEditor({
  content,
  change,
  detach,
  browse,
  readOnly,
}: {
  content: JSONContent;
  change: (content: JSONContent) => void;
  detach: (node: JSONContent) => void;
  browse?: () => void;
  readOnly?: boolean;
}) {
  return (
    <DocumentEditor
      content={content}
      onChange={change}
      onDetachBlock={readOnly ? undefined : detach}
      readOnly={readOnly}
      onBrowseComponents={browse}
      minimal
    />
  );
});

export default function SurfaceEditor({
  document: input,
  onChange,
  header,
  onBrowseComponents,
  revealId,
  onRevealHandled,
  readOnly = false,
}: {
  document: ShowDocument;
  onChange: (document: ShowDocument) => void;
  header?: ReactNode;
  onBrowseComponents?: () => void;
  readOnly?: boolean;
  revealId?: string | null;
  onRevealHandled?: () => void;
}) {
  const document = useMemo(
    () => (isSurface(input) ? input : upgradeDocument(input)),
    [input],
  );
  const current = useRef<ShowDocument>(document);
  current.current = document;
  const viewport = useRef<SurfaceHandle>(null);
  const file = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string | null>(null),
    [inspector, setInspector] = useState(false);
  const [error, setError] = useState("");
  const [deleted, setDeleted] = useState<DeletedNode | null>(null);
  const active = useRef(true),
    imageRequest = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      imageRequest.current++;
    };
  }, []);
  useEffect(() => {
    if (!revealId || !findSurfaceNode(current.current, revealId)) return;
    setSelected(revealId);
    viewport.current?.reveal(revealId);
    onRevealHandled?.();
  }, [revealId]);
  const commit = (value: ShowDocument) => {
    current.current = value;
    onChange(value);
    setError("");
  };
  const target = selected ? findSurfaceNode(document, selected) : undefined;
  const frame = selected ? document.layout?.[selected] : undefined;
  const position = (width = 360): NodeLayout => {
    const value = viewport.current!.insertPosition();
    const right = Math.max(
      value.x,
      ...orderedSurfaceNodes(current.current).map((node) => {
        const frame = current.current.layout![node.attrs!.id];
        return frame.x + frame.width + 64;
      }),
    );
    return {
      x: Math.min(1000000, Math.max(-1000000, right)),
      y: Math.min(1000000, Math.max(-1000000, value.y)),
      width,
    };
  };
  const insert = (node: JSONContent, frame: NodeLayout) => {
    commit(addNode(current.current, node, frame));
    setSelected(node.attrs!.id);
    viewport.current!.reveal(node.attrs!.id);
  };
  const add = (kind: "flow" | "grid" | "free" | "text" | "image") => {
    if (kind === "image") {
      file.current?.click();
      return;
    }
    if (kind === "text") {
      insert(
        {
          type: "richText",
          attrs: { id: crypto.randomUUID(), name: "文本" },
          content: [{ type: "paragraph" }],
        },
        position(),
      );
      return;
    }
    const region = createRegion(
      { flow: "内容区域", grid: "网格区域", free: "自由区域" }[kind],
      kind,
    );
    insert(region.node, { ...region.frame, ...position(920) });
  };
  const detach = (parentId: string, node: JSONContent) => {
    const next = detachBlock(current.current, parentId, node, position());
    commit(next);
    const id = next.content.content!.at(-1)!.attrs!.id;
    setSelected(id);
    viewport.current!.reveal(id);
  };
  const addText = (regionId: string) => {
    const region = findSurfaceNode(current.current, regionId)?.node;
    if (region?.type !== "region") return;
    const id = crypto.randomUUID();
    const x = Math.max(
      0,
      ...(region.content ?? []).map((child) => {
        const frame = current.current.layout?.[child.attrs!.id];
        return frame ? frame.x + frame.width + 24 : 0;
      }),
    );
    commit(
      addNode(
        current.current,
        {
          type: "richText",
          attrs: { id, name: "文本" },
          content: [{ type: "paragraph" }],
        },
        { x, y: 0, width: 300 },
        regionId,
      ),
    );
  };
  const render = ({ content, parentId, ids, kind }: ContentRenderProps) => {
    const single = kind === "single" ? content.content?.[0] : undefined;
    if (single?.type === "widget")
      return (
        <Widget
          kind={single.attrs!.kind}
          data={single.attrs!.data}
          readOnly={readOnly}
          onChange={(data) =>
            commit(
              editNode(current.current, parentId, (node) => {
                node.attrs = { ...node.attrs, data };
              }),
            )
          }
        />
      );
    if (single?.type === "image")
      return (
        <img
          className="surface-image"
          src={single.attrs!.src}
          alt={single.attrs?.alt ?? ""}
          title={single.attrs?.title}
          draggable={false}
        />
      );
    return (
      <RichEditor
        readOnly={readOnly}
        content={content}
        browse={onBrowseComponents}
        detach={(node) => {
          if (kind === "children") detach(parentId, node);
        }}
        change={(value) => {
          if (kind === "children")
            commit(
              replaceChildren(
                current.current,
                parentId,
                ids,
                value.content ?? [],
              ),
            );
          else
            commit(
              editNode(current.current, parentId, (node) => {
                const values = value.content ?? [];
                if (values.length === 1)
                  Object.assign(node, values[0], {
                    attrs: { ...values[0].attrs, id: parentId },
                  });
                else {
                  node.type = "richText";
                  node.content = values.map((child) =>
                    child.attrs?.id === parentId
                      ? {
                          ...child,
                          attrs: { ...child.attrs, id: crypto.randomUUID() },
                        }
                      : child,
                  );
                  node.attrs = { id: parentId, name: "文本" };
                }
              }),
            );
        }}
      />
    );
  };
  const renderRef = useRef(render);
  renderRef.current = render;
  const stableRender = useCallback(
    (props: ContentRenderProps) => renderRef.current(props),
    [readOnly],
  );
  const changeFrame = (id: string, layout: NodeLayout) => {
    const value = {
      ...current.current,
      layout: { ...current.current.layout, [id]: layout },
    };
    commit(
      layout.mode !== current.current.layout?.[id]?.mode
        ? reconcileSurface(value)
        : value,
    );
  };
  return (
    <div className="surface-editor-shell">
      <PageSurface
        ref={viewport}
        pageId={document.id}
        layoutKey={JSON.stringify(document.layout)}
        paths={nodePaths(document)}
        nodes={orderedSurfaceNodes(document).map((node) => ({
          id: node.attrs!.id,
          name: nodeName(node),
        }))}
        views={document.views!}
        header={header}
        selected={selected}
        onSelect={setSelected}
        onInspect={(id) => {
          setSelected(id);
          setInspector(true);
          viewport.current!.reveal(id);
        }}
        onAdd={readOnly ? undefined : add}
        onAddText={readOnly ? undefined : addText}
        onMove={readOnly ? undefined : changeFrame}
        onViews={
          readOnly
            ? undefined
            : (views) => commit({ ...current.current, views })
        }
        onRemove={
          readOnly
            ? undefined
            : (id) => {
                const entry = findSurfaceNode(current.current, id);
                if (!entry?.parent) return;
                setDeleted(captureDeletion(current.current, id) ?? null);
                commit(removeNode(current.current, id));
                if (selected === id) {
                  setSelected(null);
                  setInspector(false);
                }
              }
        }
        extraActions={
          deleted && (
            <button
              type="button"
              onClick={() => {
                if (findSurfaceNode(current.current, deleted.node.attrs!.id)) {
                  setDeleted(null);
                  return;
                }
                commit(restoreDeletion(current.current, deleted));
                viewport.current!.reveal(deleted.node.attrs!.id);
                setDeleted(null);
              }}
            >
              <Undo2 size={15} />
              <span>撤销删除</span>
            </button>
          )
        }
      >
        <SurfaceContent document={document} renderContent={stableRender} />
      </PageSurface>
      {inspector && target && (
        <aside
          className="surface-inspector"
          data-surface-ui
          aria-label="内容设置"
        >
          <header>
            <strong>内容设置</strong>
            <button
              type="button"
              aria-label="关闭内容设置"
              onClick={() => setInspector(false)}
            >
              <X size={16} />
            </button>
          </header>
          <label>
            名称
            <input
              aria-label="内容名称"
              maxLength={200}
              value={String(target.node.attrs?.name ?? nodeName(target.node))}
              onChange={(event) =>
                commit(
                  editNode(current.current, selected!, (node) => {
                    node.attrs = { ...node.attrs, name: event.target.value };
                  }),
                )
              }
            />
          </label>
          {target.node.type === "region" && (
            <>
              <label>
                布局
                <select
                  aria-label="区域布局"
                  value={frame?.mode ?? "flow"}
                  onChange={(event) =>
                    changeFrame(selected!, {
                      ...frame!,
                      mode: event.target.value as NodeLayout["mode"],
                    })
                  }
                >
                  <option value="flow">顺序排版</option>
                  <option value="grid">网格排版</option>
                  <option value="free">自由摆放</option>
                </select>
              </label>
              {frame?.mode === "grid" && (
                <label>
                  列数
                  <input
                    aria-label="网格列数"
                    type="number"
                    min={1}
                    max={12}
                    value={frame.columns ?? 2}
                    onChange={(event) => {
                      const columns = Number(event.target.value);
                      if (
                        Number.isInteger(columns) &&
                        columns >= 1 &&
                        columns <= 12
                      )
                        changeFrame(selected!, { ...frame, columns });
                    }}
                  />
                </label>
              )}
              <button type="button" onClick={() => addText(selected!)}>
                添加文本到区域
              </button>
            </>
          )}
          <label>
            所属区域
            <select
              aria-label="所属区域"
              value={
                target.parent?.type === "region" ? target.parent.attrs!.id : ""
              }
              onChange={(event) => {
                const parentId = event.target.value || null;
                commit(
                  moveNode(current.current, selected!, parentId, {
                    ...(frame ?? position()),
                    x: parentId ? 0 : position().x,
                    y: parentId ? 0 : position().y,
                  }),
                );
                viewport.current!.reveal(selected!);
              }}
            >
              <option value="">白板</option>
              {regionOptions(document, selected!).map((region) => (
                <option value={region.id} key={region.id}>
                  {region.name}
                </option>
              ))}
            </select>
          </label>
          <div className="surface-inspector-actions">
            {([-1, 1] as const).map((delta) => (
              <button
                type="button"
                key={delta}
                onClick={() => {
                  const entry = findSurfaceNode(current.current, selected!)!;
                  const index = entry.parent!.content!.findIndex(
                    (node) => node.attrs?.id === selected,
                  );
                  const parentId =
                    entry.parent!.type === "surface"
                      ? null
                      : entry.parent!.attrs!.id;
                  const next = moveNode(
                    current.current,
                    selected!,
                    parentId,
                    undefined,
                    Math.max(
                      0,
                      Math.min(
                        entry.parent!.content!.length - 1,
                        index + delta,
                      ),
                    ),
                  );
                  if (!parentId)
                    next.views!.readingOrder = next.content.content!.map(
                      (node) => node.attrs!.id,
                    );
                  commit(next);
                }}
              >
                {delta < 0 ? "向前排列" : "向后排列"}
              </button>
            ))}
          </div>
        </aside>
      )}
      {error && (
        <div className="surface-error" role="alert">
          {error}
          <button type="button" onClick={() => setError("")}>
            关闭
          </button>
        </div>
      )}
      <input
        ref={file}
        className="hidden"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
        onChange={async (event) => {
          const incoming = event.target.files?.[0];
          event.target.value = "";
          if (!incoming) return;
          if (
            incoming.size > 8 * 1024 * 1024 ||
            !/^image\/(png|jpeg|gif|webp|avif)$/.test(incoming.type)
          ) {
            setError("请选择 8 MB 以内的 PNG、JPEG、GIF、WebP 或 AVIF 图片。");
            return;
          }
          const ticket = ++imageRequest.current;
          const reader = new FileReader();
          reader.onerror = () => setError("图片读取失败，请重试。");
          reader.onload = () => {
            if (!active.current || ticket !== imageRequest.current) return;
            const existingBytes = new TextEncoder().encode(
              JSON.stringify(current.current),
            ).length;
            if (
              existingBytes + String(reader.result).length + 4096 >
              MAX_ARTIFACT_BYTES
            ) {
              setError(
                "加入这张图片会超过页面的 10 MB 保存上限，请先缩小图片。",
              );
              return;
            }
            insert(
              {
                type: "image",
                attrs: {
                  id: crypto.randomUUID(),
                  src: reader.result,
                  alt: incoming.name,
                  name: incoming.name.slice(0, 200),
                },
              },
              position(480),
            );
          };
          reader.readAsDataURL(incoming);
        }}
      />
    </div>
  );
}
