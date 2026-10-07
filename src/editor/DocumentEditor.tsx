import ExpandableSearch from "../components/ExpandableSearch";
import {
  useComponentCatalog,
  RegisterComponentContext,
} from "../components/useComponentCatalog";
import type { CatalogComponent } from "../core/component-categories";
import {
  splitForComponent,
  type TextInsertionPoint,
} from "./component-insertion";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useId,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor, JSONContent, Extensions } from "@tiptap/core";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import { clearWidgetSelection } from "./widget-selection";
import { CellSelection } from "@tiptap/pm/tables";
import { SelectionToolbar } from "./SelectionToolbar";
import { TableSelectionActions } from "./TableSelectionActions";
import {
  documentTableActionMeta,
  restoreDocumentTableCellSelection,
} from "./table-selection";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bold,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Code,
  CodeXml,
  Copy,
  ExternalLink,
  Expand,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  MessageSquareQuote,
  Minus,
  PanelTop,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Trash2,
  Type,
  Underline,
  Undo2,
  Upload,
  X,
} from "../ui/icons";
import { TableControls } from "./TableControls";
import { createExtensions } from "./extensions";
import "./editor.css";

export interface DocumentEditorProps {
  content: JSONContent;
  onChange: (
    content: JSONContent,
    options?: { separateHistory?: boolean },
  ) => void;
  readOnly?: boolean;
  minimal?: boolean;
  additionalExtensions?: Extensions;
  trailingNode?: boolean;
  onEditorReady?: (editor: Editor) => void;
  onInsertNative?: (
    kind: string,
    data: Record<string, unknown>,
    point: TextInsertionPoint,
  ) => void;
  onDetachBlock?: (node: JSONContent) => void;
}

interface MenuItem {
  id: string;
  title: string;
  description: string;
  keywords: string;
  icon: ReactNode;
  group: string;
  run: (editor: Editor) => void;
  component?: CatalogComponent;
}

interface SlashState {
  from: number;
  to: number;
  query: string;
  left: number;
  top: number;
  manual?: boolean;
}
interface HoverBlock {
  pos: number;
  size: number;
  top: number;
  index: number;
}
type DialogState = { type: "image" | "link"; value: string; alt: string };

function ToolButton({
  label,
  children,
  onClick,
  active,
  disabled,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`editor-tool${active ? " is-active" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function safeImageUrl(value: string) {
  return (
    /^https?:\/\//i.test(value) ||
    /^data:image\/(png|jpe?g|gif|webp|avif);base64,/i.test(value)
  );
}

function safeLinkUrl(value: string) {
  return /^(https?:\/\/|mailto:|tel:|#)/i.test(value);
}

function menuPosition(editor: Editor, from: number) {
  const rect = editor.view.coordsAtPos(
    Math.min(from, editor.state.doc.content.size),
  );
  return {
    left: Math.max(12, Math.min(rect.left, window.innerWidth - 340)),
    top: Math.max(70, Math.min(rect.bottom + 8, window.innerHeight - 370)),
  };
}

export default function DocumentEditor({
  content,
  onChange,
  readOnly = false,
  minimal = true,
  onEditorReady,
  onInsertNative,
  onDetachBlock,
  additionalExtensions,
  trailingNode = true,
}: DocumentEditorProps) {
  const latestOnChange = useRef(onChange);
  const selectionMenuId = useId();
  latestOnChange.current = onChange;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const slashInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<SlashState | null>(null);
  const dismissedSlash = useRef<string | null>(null);
  const itemsRef = useRef<MenuItem[]>([]);
  const runItemRef = useRef<(index: number) => void>(() => {});
  const selectedRef = useRef(0);
  const dragPosition = useRef<number | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const catalog = useComponentCatalog(!!slash);
  const registerComponent = useContext(RegisterComponentContext);
  const [inserting, setInserting] = useState(false);
  const insertionTicket = useRef(0);
  useEffect(
    () => () => {
      insertionTicket.current++;
    },
    [],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hover, setHover] = useState<HoverBlock | null>(null);
  const [blockMenu, setBlockMenu] = useState(false);
  const hoverHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverMenuOpen = useRef(blockMenu);
  hoverMenuOpen.current = blockMenu;
  const keepBlockHandle = useCallback(() => {
    if (hoverHideTimer.current !== null) {
      clearTimeout(hoverHideTimer.current);
      hoverHideTimer.current = null;
    }
  }, []);
  const hideBlockHandleLater = useCallback(() => {
    if (hoverHideTimer.current !== null) return;
    hoverHideTimer.current = setTimeout(() => {
      hoverHideTimer.current = null;
      const handle = wrapperRef.current?.querySelector(".block-handle");
      if (
        hoverMenuOpen.current ||
        dragPosition.current !== null ||
        handle?.contains(document.activeElement)
      )
        return;
      setHover(null);
    }, 450);
  }, []);
  useEffect(() => keepBlockHandle, [keepBlockHandle]);
  const [styleMenu, setStyleMenu] = useState(false);
  const [insertMenu, setInsertMenu] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [notice, setNotice] = useState("");
  const [bubble, setBubble] = useState<{ left: number; top: number } | null>(
    null,
  );
  const [, setRevision] = useState(0);
  const selectionBeforeDialog = useRef<{ from: number; to: number } | null>(
    null,
  );
  menuRef.current = slash;
  selectedRef.current = selectedIndex;

  const extensions = useMemo(
    () => [
      ...createExtensions({ placeholder: "输入 / 添加内容", trailingNode }),
      ...(additionalExtensions ?? []),
    ],
    [additionalExtensions, trailingNode],
  );
  const editor = useEditor({
    extensions,
    content,
    editable: !readOnly,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: "document-content",
        "aria-label": "文档内容",
        spellcheck: "false",
      },
      handleKeyDown: (_view, event) => {
        if (!menuRef.current || event.isComposing) return false;
        if (event.key === "Escape") {
          dismissSlash();
          return true;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const count = itemsRef.current.length;
          setSelectedIndex((index) =>
            count
              ? (index + (event.key === "ArrowDown" ? 1 : -1) + count) % count
              : 0,
          );
          return true;
        }
        if (event.key === "Enter" && itemsRef.current.length) {
          runItemRef.current(selectedRef.current);
          return true;
        }
        return false;
      },
      handleClick: (_view, _position, event) => {
        const link = (event.target as Element).closest?.(
          "a[href]",
        ) as HTMLAnchorElement | null;
        if (!link || (!readOnly && !event.metaKey && !event.ctrlKey))
          return false;
        const href = link.getAttribute("href") ?? "";
        if (!safeLinkUrl(href)) return true;
        if (href.startsWith("#")) {
          const target = document.getElementById(href.slice(1));
          target?.scrollIntoView({ behavior: "smooth", block: "start" });
        } else window.open(href, "_blank", "noopener,noreferrer");
        return true;
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
          file.type.startsWith("image/"),
        );
        if (!files.length) return false;
        event.preventDefault();
        void insertImageFiles(files);
        return true;
      },
    },
    onUpdate: ({ editor: current, transaction }) =>
      latestOnChange.current(current.getJSON(), {
        separateHistory: Boolean(transaction.getMeta(documentTableActionMeta)),
      }),
  });

  useEffect(() => {
    if (editor) onEditorReady?.(editor);
  }, [editor, onEditorReady]);
  useEffect(() => {
    if (editor && editor.isEditable === readOnly) {
      editor.setEditable(!readOnly, false);
      editor.view.dispatch(editor.state.tr.setMeta("editableChanged", true));
    }
    setRevision((value) => value + 1);
    if (readOnly) {
      setSlash(null);
      setHover(null);
      setBlockMenu(false);
      setStyleMenu(false);
      setInsertMenu(false);
      setDialog(null);
      setBubble(null);
    }
  }, [editor, readOnly]);
  useEffect(() => {
    if (editor && !editor.state.doc.eq(editor.schema.nodeFromJSON(content))) {
      const selection =
        editor.isFocused && editor.state.selection.toJSON().type === "text"
          ? editor.state.selection
          : null;
      const widgetId =
        editor.state.selection instanceof NodeSelection &&
        editor.state.selection.node.type.name === "widget"
          ? editor.state.selection.node.attrs.id
          : null;
      const cellSelection =
        editor.state.selection instanceof CellSelection
          ? editor.state.selection
          : null;
      editor.commands.setContent(content, { emitUpdate: false });
      if (selection) {
        const maximum = Math.max(1, editor.state.doc.content.size - 1);
        const from = Math.min(selection.from, maximum),
          to = Math.min(selection.to, maximum);
        if (
          editor.state.doc.resolve(from).parent.inlineContent &&
          editor.state.doc.resolve(to).parent.inlineContent
        )
          editor.commands.setTextSelection({ from, to });
      }
      if (cellSelection) {
        const restored = restoreDocumentTableCellSelection(
          editor.state.doc,
          cellSelection,
        );
        if (restored)
          editor.view.dispatch(editor.state.tr.setSelection(restored));
      }
      if (widgetId) {
        let position: number | undefined;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "widget" && node.attrs.id === widgetId)
            position = pos;
        });
        if (position !== undefined) editor.commands.setNodeSelection(position);
        else {
          const transaction = clearWidgetSelection(editor.state);
          if (transaction) editor.view.dispatch(transaction);
        }
      } else if (!selection) {
        const transaction = clearWidgetSelection(editor.state);
        if (transaction) editor.view.dispatch(transaction);
      }
      setSlash(null);
      setHover(null);
      setBlockMenu(false);
    }
  }, [content, editor]);

  useEffect(() => {
    if (!dialog) return;
    const focusFrame = requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>(".editor-modal input")?.focus(),
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDialog(null);
        editor?.commands.focus();
      }
      if (event.key !== "Tab") return;
      const targets = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".editor-modal button:not(:disabled), .editor-modal input:not(:disabled)",
        ),
      );
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [Boolean(dialog), editor]);

  useEffect(() => {
    if (!editor || readOnly) return;
    const clearInitialSelection = () => {
      const transaction = clearWidgetSelection(editor.state);
      if (transaction) editor.view.dispatch(transaction);
    };
    if (editor.isInitialized) clearInitialSelection();
    else editor.on("create", clearInitialSelection);
    const clearOnBlank = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      const target = event.target;
      const widget = target.closest(".document-widget");
      if (widget && editor.view.dom.contains(widget)) return;
      // Keep the selection while using its formatting, menus and dialogs.
      if (
        !widget &&
        target.closest(
          'button, input, textarea, select, a, summary, [role="button"], [role="dialog"], .block-handle, .editor-toolbar, .editor-bubble, .editor-small-menu, .editor-modal',
        )
      )
        return;
      const transaction = clearWidgetSelection(editor.state);
      if (!transaction) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && editor.view.dom.contains(active))
        active.blur();
      editor.view.dispatch(transaction);
      // Editor whitespace otherwise lets ProseMirror select the nearest atom again.
      if (
        editor.view.dom.contains(target) &&
        !target.closest("[data-block-id]")
      )
        event.preventDefault();
    };
    document.addEventListener("pointerdown", clearOnBlank, true);
    return () => {
      editor.off("create", clearInitialSelection);
      document.removeEventListener("pointerdown", clearOnBlank, true);
    };
  }, [editor, readOnly]);

  useEffect(() => {
    if (!slash?.manual) return;
    const frame = requestAnimationFrame(() => slashInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [slash?.manual]);

  useEffect(() => {
    if (!styleMenu && !insertMenu && !blockMenu) return;
    const closeMenus = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setStyleMenu(false);
      setInsertMenu(false);
      setBlockMenu(false);
      editor?.commands.focus();
    };
    document.addEventListener("keydown", closeMenus);
    return () => document.removeEventListener("keydown", closeMenus);
  }, [styleMenu, insertMenu, blockMenu, editor]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      setRevision((value) => value + 1);
      if (!editor.isEditable) return;
      const { selection } = editor.state;
      const { $from, from, to, empty } = selection;
      if (!menuRef.current?.manual) {
        const text = $from.parent.isTextblock
          ? $from.parent.textBetween(0, $from.parentOffset, "\n")
          : "";
        const match = empty && text.match(/^\/([^\n/]*)$/);
        if (match) {
          const start = from - match[0].length;
          if (dismissedSlash.current !== `${start}:${to}:${match[1]}`) {
            dismissedSlash.current = null;
            setSlash({
              from: start,
              to,
              query: match[1],
              ...menuPosition(editor, from),
            });
          }
        } else {
          setSlash(null);
          dismissedSlash.current = null;
        }
      }
      if (
        !empty &&
        editor.isFocused &&
        !editor.isActive("codeBlock") &&
        !editor.isActive("widget") &&
        !editor.isActive("pageModule")
      ) {
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        setBubble({
          left: (start.left + end.right) / 2,
          top: start.top,
        });
      } else setBubble(null);
    };
    const hideBubble = () => setBubble(null);
    const blur = ({ event }: { event: FocusEvent }) => {
      if (
        !(event.relatedTarget instanceof Element) ||
        event.relatedTarget.closest(".editor-bubble")?.id !== selectionMenuId
      )
        hideBubble();
    };
    const viewportChanged = (event: Event) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.contains(editor.view.dom)
      )
        return;
      setBubble(null);
      setSlash(null);
      setBlockMenu(false);
      setHover(null);
    };
    editor.on("transaction", refresh);
    editor.on("focus", refresh);
    editor.on("blur", blur);
    editor.view.dom.addEventListener("contextmenu", hideBubble);
    window.addEventListener("scroll", hideBubble, true);
    window.addEventListener("resize", refresh);
    window.addEventListener("showai:viewport-change", viewportChanged);
    return () => {
      editor.off("transaction", refresh);
      editor.off("focus", refresh);
      editor.off("blur", blur);
      editor.view.dom.removeEventListener("contextmenu", hideBubble);
      window.removeEventListener("scroll", hideBubble, true);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("showai:viewport-change", viewportChanged);
    };
  }, [editor, selectionMenuId]);

  useEffect(() => setSelectedIndex(0), [slash?.query]);
  useEffect(() => {
    document
      .querySelector(".slash-menu .slash-item.is-selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  function dismissSlash() {
    const current = menuRef.current;
    if (current && !current.manual)
      dismissedSlash.current = `${current.from}:${current.to}:${current.query}`;
    menuRef.current = null;
    setSlash(null);
  }

  const openDialog = useCallback(
    (type: "image" | "link") => {
      if (!editor) return;
      selectionBeforeDialog.current = {
        from: editor.state.selection.from,
        to: editor.state.selection.to,
      };
      setDialog({
        type,
        value: type === "link" ? (editor.getAttributes("link").href ?? "") : "",
        alt: "",
      });
      setDialogError("");
      setInsertMenu(false);
      setBubble(null);
    },
    [editor],
  );

  async function insertImageFiles(
    files: File[],
    restoreDialogSelection = false,
  ) {
    if (!editor || !editor.isEditable) return;
    if (restoreDialogSelection && selectionBeforeDialog.current)
      editor.commands.setTextSelection(selectionBeforeDialog.current);
    let bookmark = editor.state.selection.getBookmark();
    const mapBookmark = ({
      transaction,
    }: {
      transaction: import("@tiptap/pm/state").Transaction;
    }) => {
      bookmark = bookmark.map(transaction.mapping);
    };
    editor.on("transaction", mapBookmark);
    for (const file of files) {
      if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type)) {
        setNotice("支持 PNG、JPEG、GIF、WebP 和 AVIF 图片。");
        continue;
      }
      if (file.size > 8 * 1024 * 1024) {
        setNotice("图片需小于 8 MB，请压缩后重试。");
        continue;
      }
      let source: string;
      try {
        source = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.onabort = () => reject(new Error("读取已取消"));
          reader.readAsDataURL(file);
        });
      } catch {
        setNotice(`无法读取「${file.name}」，请重新选择图片。`);
        continue;
      }
      if (editor.isDestroyed || !editor.isEditable) break;
      const selection = bookmark.resolve(editor.state.doc);
      editor.view.dispatch(editor.state.tr.setSelection(selection));
      editor.chain().focus().setImage({ src: source, alt: file.name }).run();
      bookmark = editor.state.selection.getBookmark();
    }
    editor.off("transaction", mapBookmark);
    setDialog(null);
  }

  const items: MenuItem[] = useMemo(
    () => [
      {
        id: "text",
        title: "正文",
        description: "从一个简单的段落开始",
        keywords: "text paragraph 正文 文本",
        icon: <Type size={20} />,
        group: "基础内容",
        run: (e: Editor) => {
          e.chain().focus().setParagraph().run();
        },
      },
      ...([1, 2, 3] as const).map((level) => ({
        id: `heading-${level}`,
        title: `标题 ${level}`,
        description: ["清晰的章节标题", "内容的次级标题", "细分主题的小标题"][
          level - 1
        ],
        keywords: `heading h${level} 标题`,
        icon:
          level === 1 ? (
            <Heading1 size={20} />
          ) : level === 2 ? (
            <Heading2 size={20} />
          ) : (
            <Heading3 size={20} />
          ),
        group: "基础内容",
        run: (e: Editor) => {
          e.chain().focus().setHeading({ level }).run();
        },
      })),
      {
        id: "bullet",
        title: "无序列表",
        description: "梳理想法与要点",
        keywords: "bullet list 无序 列表",
        icon: <List size={20} />,
        group: "基础内容",
        run: (e: Editor) => {
          e.chain().focus().toggleBulletList().run();
        },
      },
      {
        id: "ordered",
        title: "有序列表",
        description: "有条理地组织步骤",
        keywords: "ordered numbered list 有序 编号 列表",
        icon: <ListOrdered size={20} />,
        group: "基础内容",
        run: (e: Editor) => {
          e.chain().focus().toggleOrderedList().run();
        },
      },
      {
        id: "todo",
        title: "待办事项",
        description: "将想法变成可勾选的行动",
        keywords: "todo task check 待办 任务 清单",
        icon: <CheckSquare size={20} />,
        group: "基础内容",
        run: (e: Editor) => {
          e.chain().focus().toggleTaskList().run();
        },
      },
      {
        id: "quote",
        title: "引用",
        description: "值得留意的一段话",
        keywords: "blockquote quote 引用",
        icon: <Quote size={20} />,
        group: "基础内容",
        run: (e: Editor) => {
          e.chain().focus().toggleBlockquote().run();
        },
      },
      {
        id: "callout",
        title: "提示块",
        description: "为关键发现留一点空间",
        keywords: "callout note 提示 高亮 注释",
        icon: <MessageSquareQuote size={20} />,
        group: "基础内容",
        run: (e: Editor) => {
          e.chain()
            .focus()
            .insertContent({
              type: "callout",
              attrs: { icon: "💡", tone: "sage" },
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "在这里记录一个值得注意的发现。" },
                  ],
                },
              ],
            })
            .run();
        },
      },
      {
        id: "toggle",
        title: "折叠内容",
        description: "让补充细节按需展开",
        keywords: "toggle details 折叠 展开",
        icon: <ChevronRight size={20} />,
        group: "基础内容",
        run: (e: Editor) => {
          e.chain()
            .focus()
            .insertContent({
              type: "toggle",
              attrs: { title: "展开了解更多", open: true },
              content: [{ type: "paragraph" }],
            })
            .run();
        },
      },
      {
        id: "divider",
        title: "分割线",
        description: "给内容一个自然的停顿",
        keywords: "divider hr 分割 线",
        icon: <Minus size={20} />,
        group: "基础内容",
        run: (e: Editor) => {
          e.chain().focus().setHorizontalRule().run();
        },
      },
      {
        id: "image",
        title: "图片",
        description: "上传图片或粘贴图片链接",
        keywords: "image photo 图片 照片",
        icon: <ImagePlus size={20} />,
        group: "丰富内容",
        run: () => openDialog("image"),
      },
      {
        id: "code",
        title: "代码块",
        description: "保留格式的代码与片段",
        keywords: "code snippet 代码",
        icon: <CodeXml size={20} />,
        group: "丰富内容",
        run: (e: Editor) => {
          e.chain().focus().toggleCodeBlock().run();
        },
      },
      {
        id: "table",
        title: "简单表格",
        description: "整理一组结构化的信息",
        keywords: "table 表格",
        icon: <Table2 size={20} />,
        group: "丰富内容",
        run: (e: Editor) => {
          e.chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run();
        },
      },
      ...catalog.items
        .filter(
          (item) => !("kind" in item && item.insertion) || !!onInsertNative,
        )
        .map((item) => ({
          id:
            "catalog:" +
            ("kind" in item
              ? item.kind
              : `${item.id}@${item.version}#${item.integrity}`),
          title: item.name,
          description: item.description,
          keywords: `${"kind" in item ? item.kind : item.id} ${item.description}`,
          icon: <PanelTop size={20} />,
          group: "组件",
          component: item,
          run: () => {},
        })),
    ],
    [openDialog, onInsertNative, catalog.items],
  );
  const filteredItems = items.filter((item) =>
    `${item.title} ${item.keywords}`
      .toLowerCase()
      .includes(slash?.query.toLowerCase() ?? ""),
  );
  itemsRef.current = filteredItems;

  const runItem = async (index: number) => {
    const state = menuRef.current;
    const item = itemsRef.current[index];
    if (!editor || !state || !item || inserting) return;
    if (item.component) {
      const before = editor.state.doc;
      const ticket = ++insertionTicket.current;
      setInserting(true);
      try {
        const value = await catalog.resolve(item.component);
        if (ticket !== insertionTicket.current || editor.isDestroyed) return;
        if (menuRef.current !== state || !editor.state.doc.eq(before)) return;
        setSlash(null);
        menuRef.current = null;
        if (value.component) registerComponent(value.component);
        if (value.native && onInsertNative) {
          const transaction = editor.state.tr.delete(state.from, state.to);
          onInsertNative(
            value.kind,
            value.data,
            splitForComponent(transaction.doc, state.from),
          );
        } else {
          editor
            .chain()
            .focus()
            .deleteRange({ from: state.from, to: state.to })
            .insertContent({
              type: "widget",
              attrs: { kind: value.kind, data: value.data },
            })
            .run();
        }
      } catch (reason) {
        setNotice((reason as Error).message);
      } finally {
        if (ticket === insertionTicket.current) setInserting(false);
      }
      return;
    }
    setSlash(null);
    menuRef.current = null;
    if (state.from !== state.to)
      editor
        .chain()
        .focus()
        .deleteRange({ from: state.from, to: state.to })
        .run();
    else editor.commands.focus();
    item.run(editor);
  };
  runItemRef.current = runItem;

  const openSlash = () => {
    if (!editor) return;
    dismissedSlash.current = null;
    const { from, to } = editor.state.selection;
    setSlash({
      from,
      to,
      query: "",
      manual: true,
      ...menuPosition(editor, from),
    });
    setSelectedIndex(0);
    setInsertMenu(false);
  };

  const blockAdd = () => {
    if (!editor || !hover) return;
    const position = hover.pos + hover.size;
    editor
      .chain()
      .focus()
      .insertContentAt(position, { type: "paragraph" })
      .setTextSelection(position + 1)
      .run();
    setSlash({
      from: position + 1,
      to: position + 1,
      query: "",
      manual: true,
      ...menuPosition(editor, position + 1),
    });
    setBlockMenu(false);
  };

  function moveBlock(position: number, direction: -1 | 1) {
    if (!editor) return;
    const nodes: { pos: number; size: number }[] = [];
    editor.state.doc.forEach((node, pos) =>
      nodes.push({ pos, size: node.nodeSize }),
    );
    const index = nodes.findIndex((node) => node.pos === position);
    const other = nodes[index + direction];
    const source = editor.state.doc.nodeAt(position);
    if (!other || !source) return;
    const target =
      direction === -1 ? other.pos : other.pos + other.size - source.nodeSize;
    const transaction = editor.state.tr
      .delete(position, position + source.nodeSize)
      .insert(target, source);
    transaction.setSelection(
      Selection.near(transaction.doc.resolve(target + 1)),
    );
    editor.view.dispatch(transaction);
    editor.view.focus();
    setBlockMenu(false);
    setHover(null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!editor || !editor.isEditable) return;
    const sourcePosition = dragPosition.current;
    if (sourcePosition !== null) {
      event.preventDefault();
      event.stopPropagation();
      const node = editor.state.doc.nodeAt(sourcePosition);
      if (!node) return;
      let destination = editor.state.doc.content.size;
      let found = false;
      editor.state.doc.forEach((_node, position) => {
        const dom = editor.view.nodeDOM(position);
        if (!(dom instanceof HTMLElement) || found) return;
        const rect = dom.getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) {
          destination = position;
          found = true;
        }
      });
      if (
        destination !== sourcePosition &&
        destination !== sourcePosition + node.nodeSize
      ) {
        const adjusted =
          destination > sourcePosition
            ? destination - node.nodeSize
            : destination;
        const transaction = editor.state.tr
          .delete(sourcePosition, sourcePosition + node.nodeSize)
          .insert(adjusted, node);
        transaction.setSelection(
          Selection.near(transaction.doc.resolve(adjusted + 1)),
        );
        editor.view.dispatch(transaction);
      }
      dragPosition.current = null;
      setHover(null);
      return;
    }
    const images = [...event.dataTransfer.files].filter((file) =>
      file.type.startsWith("image/"),
    );
    if (images.length) {
      event.preventDefault();
      event.stopPropagation();
      const position = editor.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });
      if (position) editor.commands.setTextSelection(position.pos);
      void insertImageFiles(images);
    }
  }

  if (!editor)
    return <div className="editor-loading" aria-label="正在打开文档" />;

  const textStyle = editor.isActive("heading", { level: 1 })
    ? "标题 1"
    : editor.isActive("heading", { level: 2 })
      ? "标题 2"
      : editor.isActive("heading", { level: 3 })
        ? "标题 3"
        : "正文";
  const formatButtons = (
    <>
      <ToolButton
        label="粗体 ⌘B"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={16} />
      </ToolButton>
      <ToolButton
        label="斜体 ⌘I"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={16} />
      </ToolButton>
      <ToolButton
        label="下划线 ⌘U"
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline size={16} />
      </ToolButton>
      <ToolButton
        label="删除线"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={16} />
      </ToolButton>
      <ToolButton
        label="文字高亮"
        active={editor.isActive("highlight")}
        onClick={() =>
          editor.chain().focus().toggleHighlight({ color: "#e8eed0" }).run()
        }
      >
        <Highlighter size={16} />
      </ToolButton>
      <ToolButton
        label="行内代码"
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code size={16} />
      </ToolButton>
      <ToolButton
        label="添加链接 ⇧⌘K"
        active={editor.isActive("link")}
        onClick={() => openDialog("link")}
      >
        <Link2 size={16} />
      </ToolButton>
    </>
  );

  return (
    <div
      className={`document-editor${readOnly ? " is-readonly" : ""}${minimal ? " is-minimal" : ""}`}
    >
      {!readOnly && !minimal && (
        <div className="editor-toolbar" role="toolbar" aria-label="文档格式">
          <div className="toolbar-style">
            <button
              className="text-style-button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setStyleMenu(!styleMenu);
                setInsertMenu(false);
              }}
              aria-expanded={styleMenu}
            >
              {textStyle}
              <ChevronDown size={13} />
            </button>
            {styleMenu && (
              <>
                <div
                  className="editor-menu-dismiss"
                  onClick={() => setStyleMenu(false)}
                />
                <div className="editor-small-menu style-menu">
                  {items.slice(0, 4).map((item) => (
                    <button
                      key={item.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        item.run(editor);
                        setStyleMenu(false);
                      }}
                    >
                      {item.icon}
                      <span>{item.title}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <span className="toolbar-divider" />
          {formatButtons}
          <span className="toolbar-divider" />
          <ToolButton
            label="无序列表"
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List size={17} />
          </ToolButton>
          <ToolButton
            label="待办事项"
            active={editor.isActive("taskList")}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          >
            <CheckSquare size={16} />
          </ToolButton>
          <div className="toolbar-insert">
            <ToolButton
              label="更多格式与插入"
              active={insertMenu}
              onClick={() => {
                setInsertMenu(!insertMenu);
                setStyleMenu(false);
              }}
            >
              <Plus size={17} />
            </ToolButton>
            {insertMenu && (
              <>
                <div
                  className="editor-menu-dismiss"
                  onClick={() => setInsertMenu(false)}
                />
                <div className="editor-small-menu insert-menu">
                  <button onClick={openSlash}>
                    <Plus size={16} />
                    插入内容<span className="menu-key">/</span>
                  </button>
                  <button
                    onClick={() => {
                      editor.chain().focus().toggleOrderedList().run();
                      setInsertMenu(false);
                    }}
                  >
                    <ListOrdered size={16} />
                    有序列表
                  </button>
                  <button
                    onClick={() => {
                      editor.chain().focus().toggleBlockquote().run();
                      setInsertMenu(false);
                    }}
                  >
                    <Quote size={16} />
                    引用
                  </button>
                  <button onClick={() => openDialog("image")}>
                    <ImagePlus size={16} />
                    插入图片
                  </button>
                  <button
                    onClick={() => {
                      editor
                        .chain()
                        .focus()
                        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                        .run();
                      setInsertMenu(false);
                    }}
                  >
                    <Table2 size={16} />
                    插入表格
                  </button>
                  <div className="menu-rule" />
                  <div className="align-tools">
                    <ToolButton
                      label="左对齐"
                      active={editor.isActive({ textAlign: "left" })}
                      onClick={() =>
                        editor.chain().focus().setTextAlign("left").run()
                      }
                    >
                      <AlignLeft size={17} />
                    </ToolButton>
                    <ToolButton
                      label="居中"
                      active={editor.isActive({ textAlign: "center" })}
                      onClick={() =>
                        editor.chain().focus().setTextAlign("center").run()
                      }
                    >
                      <AlignCenter size={17} />
                    </ToolButton>
                    <ToolButton
                      label="右对齐"
                      active={editor.isActive({ textAlign: "right" })}
                      onClick={() =>
                        editor.chain().focus().setTextAlign("right").run()
                      }
                    >
                      <AlignRight size={17} />
                    </ToolButton>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="toolbar-spacer" />
          <ToolButton
            label="撤销 ⌘Z"
            disabled={!editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 size={16} />
          </ToolButton>
          <ToolButton
            label="重做 ⇧⌘Z"
            disabled={!editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 size={16} />
          </ToolButton>
        </div>
      )}

      <div
        className="editor-canvas"
        ref={wrapperRef}
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.shiftKey &&
            event.key.toLowerCase() === "k" &&
            !readOnly
          ) {
            event.preventDefault();
            event.stopPropagation();
            openDialog("link");
          }
        }}
        onMouseEnter={keepBlockHandle}
        onMouseMove={(event) => {
          if (readOnly || blockMenu || dragPosition.current !== null) return;
          if ((event.target as Element).closest(".block-handle")) {
            keepBlockHandle();
            return;
          }
          const wrapper = wrapperRef.current;
          if (!wrapper) return;
          if (
            (event.target as Element).closest(".document-editor") !==
            wrapper.closest(".document-editor")
          )
            return;
          let next: HoverBlock | null = null;
          editor.state.doc.forEach((node, pos, index) => {
            const dom = editor.view.nodeDOM(pos);
            if (!(dom instanceof HTMLElement)) return;
            const rect = dom.getBoundingClientRect();
            if (
              event.clientY >= rect.top - 3 &&
              event.clientY <= rect.bottom + 3
            )
              next = {
                pos,
                size: node.nodeSize,
                index,
                top:
                  (rect.top - wrapper.getBoundingClientRect().top) /
                  (wrapper.getBoundingClientRect().width /
                    wrapper.offsetWidth || 1),
              };
          });
          if (next) {
            keepBlockHandle();
            setHover(next);
          } else hideBlockHandleLater();
        }}
        onMouseLeave={hideBlockHandleLater}
        onDragOver={(event) => {
          if (
            dragPosition.current !== null ||
            [...event.dataTransfer.types].includes("Files")
          )
            event.preventDefault();
        }}
        onDropCapture={handleDrop}
      >
        <EditorContent editor={editor} />
        {!readOnly && <TableControls editor={editor} />}
        {!readOnly && hover && (
          <div
            className="block-handle"
            style={{ top: hover.top }}
            onMouseEnter={keepBlockHandle}
            onFocus={keepBlockHandle}
          >
            <button
              aria-label="在下方添加内容"
              title="添加内容"
              onMouseDown={(event) => event.preventDefault()}
              onClick={blockAdd}
            >
              <Plus size={15} />
            </button>
            <button
              aria-label="移动或管理内容块"
              title="拖动排序 · 点击管理"
              draggable
              onDragStart={(event) => {
                keepBlockHandle();
                dragPosition.current = hover.pos;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                  "application/x-showai-block",
                  String(hover.pos),
                );
                const dom = editor.view.nodeDOM(hover.pos);
                if (dom instanceof HTMLElement)
                  event.dataTransfer.setDragImage(dom, 0, 0);
                setBlockMenu(false);
              }}
              onDragEnd={() => {
                dragPosition.current = null;
              }}
              onClick={() => setBlockMenu(!blockMenu)}
            >
              <GripVertical size={15} />
            </button>
            {blockMenu && (
              <>
                <div
                  className="editor-menu-dismiss"
                  onClick={() => setBlockMenu(false)}
                />
                <div className="editor-small-menu block-menu">
                  {minimal &&
                    ["paragraph", "heading"].includes(
                      editor.state.doc.nodeAt(hover.pos)?.type.name ?? "",
                    ) && (
                      <>
                        <div
                          className="align-tools"
                          role="group"
                          aria-label="内容块样式"
                        >
                          {items.slice(0, 4).map((item, index) => (
                            <ToolButton
                              key={item.id}
                              label={item.title}
                              active={
                                index === 0
                                  ? editor.state.doc.nodeAt(hover.pos)?.type
                                      .name === "paragraph"
                                  : editor.state.doc.nodeAt(hover.pos)?.attrs
                                      .level === index
                              }
                              onClick={() => {
                                editor
                                  .chain()
                                  .focus()
                                  .setTextSelection(hover.pos + 1)
                                  .run();
                                item.run(editor);
                                setBlockMenu(false);
                              }}
                            >
                              {item.icon}
                            </ToolButton>
                          ))}
                        </div>
                        <div className="align-tools">
                          {(
                            [
                              [
                                "left",
                                "左对齐",
                                <AlignLeft key="left" size={16} />,
                              ],
                              [
                                "center",
                                "居中",
                                <AlignCenter key="center" size={16} />,
                              ],
                              [
                                "right",
                                "右对齐",
                                <AlignRight key="right" size={16} />,
                              ],
                            ] as const
                          ).map(([align, label, icon]) => (
                            <ToolButton
                              key={align}
                              label={label}
                              active={
                                editor.state.doc.nodeAt(hover.pos)?.attrs
                                  .textAlign === align
                              }
                              onClick={() => {
                                editor
                                  .chain()
                                  .focus()
                                  .setTextSelection(hover.pos + 1)
                                  .setTextAlign(align)
                                  .run();
                                setBlockMenu(false);
                              }}
                            >
                              {icon}
                            </ToolButton>
                          ))}
                        </div>
                        <div className="menu-rule" />
                      </>
                    )}
                  {onDetachBlock && (
                    <button
                      onClick={() => {
                        const node = editor.state.doc.nodeAt(hover.pos);
                        if (node) onDetachBlock(node.toJSON());
                        setBlockMenu(false);
                        setHover(null);
                      }}
                    >
                      <Expand size={15} />
                      移出区域
                    </button>
                  )}
                  <button
                    disabled={hover.index === 0}
                    onClick={() => moveBlock(hover.pos, -1)}
                  >
                    <ArrowUp size={15} />
                    向上移动
                  </button>
                  <button
                    disabled={hover.index === editor.state.doc.childCount - 1}
                    onClick={() => moveBlock(hover.pos, 1)}
                  >
                    <ArrowDown size={15} />
                    向下移动
                  </button>
                  <button
                    onClick={() => {
                      const node = editor.state.doc.nodeAt(hover.pos);
                      if (node)
                        editor
                          .chain()
                          .focus()
                          .insertContentAt(
                            hover.pos + node.nodeSize,
                            node.toJSON(),
                          )
                          .run();
                      setBlockMenu(false);
                    }}
                  >
                    <Copy size={15} />
                    复制内容块
                  </button>
                  <div className="menu-rule" />
                  <button
                    className="danger"
                    onClick={() => {
                      editor
                        .chain()
                        .focus()
                        .deleteRange({
                          from: hover.pos,
                          to: hover.pos + hover.size,
                        })
                        .run();
                      setBlockMenu(false);
                      setHover(null);
                    }}
                  >
                    <Trash2 size={15} />
                    删除
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {!readOnly && !minimal && (
        <button
          className="document-add-block"
          onClick={() => {
            editor.chain().focus("end").run();
            if (
              editor.state.selection.$from.parent.type.name !== "paragraph" ||
              editor.state.selection.$from.parent.content.size
            ) {
              editor
                .chain()
                .insertContentAt(editor.state.doc.content.size, {
                  type: "paragraph",
                })
                .focus("end")
                .run();
            }
            openSlash();
          }}
        >
          <Plus size={15} />
          <span>添加内容</span>
          <kbd>/</kbd>
        </button>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
        className="editor-hidden-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void insertImageFiles([file], true);
          event.target.value = "";
        }}
      />
      {notice && (
        <div className="editor-notice" role="status">
          {notice}
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            <X size={14} />
          </button>
        </div>
      )}

      {bubble && !readOnly && (
        <SelectionToolbar
          id={selectionMenuId}
          anchor={bubble}
          onEscape={() => {
            if (editor.state.selection instanceof CellSelection)
              editor.view.dispatch(
                editor.state.tr.setSelection(
                  TextSelection.near(editor.state.selection.$from),
                ),
              );
            setBubble(null);
            editor.view.focus();
          }}
        >
          {formatButtons}
          <TableSelectionActions editor={editor} />
        </SelectionToolbar>
      )}

      {slash &&
        !readOnly &&
        createPortal(
          <>
            <div
              className="slash-dismiss"
              onClick={() => {
                dismissSlash();
                editor.commands.focus();
              }}
            />
            <div
              className={`slash-menu${minimal ? " is-minimal" : ""}`}
              role="dialog"
              aria-label="插入内容"
              style={{ left: slash.left, top: slash.top }}
            >
              <div className="slash-search">
                {slash.manual ? (
                  <ExpandableSearch
                    label="搜索内容块"
                    placeholder="搜索内容…"
                    defaultExpanded
                    inputRef={slashInputRef}
                    value={slash.query}
                    onChange={(value) => setSlash({ ...slash, query: value })}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        dismissSlash();
                        editor.commands.focus();
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        runItem(selectedIndex);
                      }
                      if (
                        event.key === "ArrowDown" ||
                        event.key === "ArrowUp"
                      ) {
                        event.preventDefault();
                        setSelectedIndex((index) =>
                          filteredItems.length
                            ? (index +
                                (event.key === "ArrowDown" ? 1 : -1) +
                                filteredItems.length) %
                              filteredItems.length
                            : 0,
                        );
                      }
                    }}
                  />
                ) : (
                  <span>{slash.query || "添加到文档"}</span>
                )}
                <kbd>esc</kbd>
              </div>
              <div
                className="slash-items"
                role="listbox"
                aria-label="内容块类型"
                aria-busy={inserting || catalog.loading}
              >
                {catalog.error && (
                  <p role="alert" className="slash-empty">
                    {catalog.error}
                  </p>
                )}
                {filteredItems.length === 0 && (
                  <div className="slash-empty">没有找到相关内容块</div>
                )}
                {filteredItems.map((item, index) => (
                  <div key={item.id}>
                    {(index === 0 ||
                      filteredItems[index - 1].group !== item.group) && (
                      <div className="slash-group">{item.group}</div>
                    )}
                    <button
                      role="option"
                      disabled={inserting}
                      aria-selected={index === selectedIndex}
                      className={`slash-item${index === selectedIndex ? " is-selected" : ""}`}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => runItem(index)}
                    >
                      <span className="slash-item-icon">{item.icon}</span>
                      <span>
                        <strong>{item.title}</strong>
                        {!minimal && <small>{item.description}</small>}
                      </span>
                      {index === selectedIndex && (
                        <span className="slash-enter">↵</span>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>,
          document.body,
        )}

      {dialog &&
        createPortal(
          <div
            className="editor-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setDialog(null);
            }}
          >
            <form
              className="editor-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="editor-dialog-title"
              onKeyDown={(event) => {
                if (event.key === "Escape") setDialog(null);
              }}
              onSubmit={(event) => {
                event.preventDefault();
                const value = dialog.value.trim();
                if (dialog.type === "image" && !safeImageUrl(value)) {
                  setDialogError("请输入有效的 http 或 https 图片链接。");
                  return;
                }
                if (dialog.type === "link" && value && !safeLinkUrl(value)) {
                  setDialogError(
                    "请输入 https://、mailto:、tel: 或 # 开头的链接。",
                  );
                  return;
                }
                if (selectionBeforeDialog.current)
                  editor.commands.setTextSelection(
                    selectionBeforeDialog.current,
                  );
                if (dialog.type === "image")
                  editor
                    .chain()
                    .focus()
                    .setImage({ src: value, alt: dialog.alt })
                    .run();
                else if (!value)
                  editor
                    .chain()
                    .focus()
                    .extendMarkRange("link")
                    .unsetLink()
                    .run();
                else if (
                  editor.state.selection.empty &&
                  !editor.isActive("link")
                )
                  editor
                    .chain()
                    .focus()
                    .insertContent({
                      type: "text",
                      text: value,
                      marks: [{ type: "link", attrs: { href: value } }],
                    })
                    .run();
                else
                  editor
                    .chain()
                    .focus()
                    .extendMarkRange("link")
                    .setLink({ href: value })
                    .run();
                setDialog(null);
              }}
            >
              <div className="editor-modal-heading">
                <div className="editor-modal-symbol">
                  {dialog.type === "image" ? (
                    <ImagePlus size={21} />
                  ) : (
                    <Link2 size={21} />
                  )}
                </div>
                <h3 id="editor-dialog-title">
                  {dialog.type === "image" ? "插入图片" : "添加链接"}
                </h3>
                <button
                  type="button"
                  aria-label="关闭弹窗"
                  onClick={() => setDialog(null)}
                >
                  <X size={18} />
                </button>
              </div>
              {dialog.type === "image" && (
                <button
                  className="image-upload-area"
                  type="button"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={23} />
                  <strong>选择本地图片</strong>
                  <span>PNG、JPEG、GIF、WebP、AVIF · 最大 8 MB</span>
                </button>
              )}
              <label className="editor-field">
                <span>
                  {dialog.type === "image" ? "或使用图片链接" : "链接地址"}
                </span>
                <input
                  autoFocus
                  type="text"
                  placeholder="https://"
                  value={dialog.value}
                  onChange={(event) => {
                    setDialog({ ...dialog, value: event.target.value });
                    setDialogError("");
                  }}
                />
              </label>
              {dialog.type === "image" && (
                <label className="editor-field">
                  <span>
                    图片描述 <small>可选</small>
                  </span>
                  <input
                    placeholder="用一句话描述图片"
                    value={dialog.alt}
                    onChange={(event) =>
                      setDialog({ ...dialog, alt: event.target.value })
                    }
                  />
                </label>
              )}
              {dialogError && (
                <p className="editor-field-error" role="alert">
                  {dialogError}
                </p>
              )}
              <div className="editor-modal-actions">
                {dialog.type === "link" && editor.isActive("link") && (
                  <button
                    type="button"
                    className="editor-text-action"
                    onClick={() => {
                      editor
                        .chain()
                        .focus()
                        .extendMarkRange("link")
                        .unsetLink()
                        .run();
                      setDialog(null);
                    }}
                  >
                    移除链接
                  </button>
                )}
                <button
                  type="button"
                  className="editor-secondary"
                  onClick={() => setDialog(null)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="editor-primary"
                  disabled={dialog.type === "image" && !dialog.value.trim()}
                >
                  <Check size={15} />
                  {dialog.type === "image" ? "插入图片" : "确认"}
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}
      {readOnly && (
        <span className="editor-readonly-note">
          <ExternalLink size={12} />
          交互阅读模式
        </span>
      )}
    </div>
  );
}
