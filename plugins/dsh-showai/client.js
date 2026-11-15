window.__ModuleLoader__.load({
  id: "@showai/dsh-showai",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;

    const NS = "showai-page";
    const ROUTE = "/showai-page-preview";
    const TOOLS = ["mcp__showai__page_present", "mcp__showai__render_document", "mcp__showai__show_component"];
    const COLLAPSED_HEIGHT = 420;
    const TAIL_HEIGHT = 460;
    const EXPANDED_HEIGHT = "76vh";

    const zh = {
      "row.title": "ShowAI 页面",
      "row.running": "正在生成 ShowAI 页面",
      "row.failed": "ShowAI 页面生成失败",
      "row.stopped": "ShowAI 页面生成已中止",
      "row.page": "页面",
      "row.fragment": "局部",
      "preview.checking": "正在载入预览…",
      "preview.missing": "这一页没有被宿主缓存，请打开完整 HTML 文件查看。",
      "preview.failed": "预览加载失败。",
      "action.reload": "重新载入预览",
      "action.expand": "展开预览",
      "action.collapse": "收起预览",
      "action.open": "在新标签页打开",
      "action.openFile": "打开完整 HTML",
      "action.output": "工具输出",
      "action.hide": "隐藏页面",
      "action.show": "显示页面",
    };
    const en = {
      "row.title": "ShowAI page",
      "row.running": "Generating the ShowAI page",
      "row.failed": "ShowAI page failed",
      "row.stopped": "ShowAI page was interrupted",
      "row.page": "Page",
      "row.fragment": "Partial",
      "preview.checking": "Loading preview…",
      "preview.missing": "The host cached no preview for this page; open the full HTML file instead.",
      "preview.failed": "The preview failed to load.",
      "action.reload": "Reload preview",
      "action.expand": "Expand preview",
      "action.collapse": "Collapse preview",
      "action.open": "Open in a new tab",
      "action.openFile": "Open the full HTML",
      "action.output": "Tool output",
      "action.hide": "Hide page",
      "action.show": "Show page",
    };

    const css = `
.showai-page-card{display:flex;flex-direction:column}
.showai-page-row{align-items:center;min-width:0;height:24px;display:flex;position:relative;overflow:hidden}
.showai-page-card[data-state=running] .showai-page-row:after{content:"";background:linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);pointer-events:none;width:300px;animation:showai-page-sweep 2.6s ease-out infinite;position:absolute;inset:0 auto 0 0}
@keyframes showai-page-sweep{0%{left:-300px}90%,to{left:100%}}
.showai-page-leading{width:16px;height:16px;flex:none;justify-content:center;align-items:center;margin-right:6px;display:inline-flex;color:var(--dsw-alias-label-tertiary)}
.showai-page-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary)}
.showai-page-card[data-state=error] .showai-page-dot{background:var(--dsw-alias-state-error-primary)}
.showai-page-card[data-state=stopped] .showai-page-dot{background:var(--dsw-alias-state-warn-primary)}
.showai-page-title{color:var(--dsw-alias-label-secondary);flex:none;font-size:14px;line-height:24px}
.showai-page-sep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}
.showai-page-summary{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;font-size:14px;line-height:24px;overflow:hidden}
.showai-page-summary[data-error]{color:var(--dsw-alias-state-error-primary)}
.showai-page-actions{display:flex;flex:none;align-items:center;gap:2px;margin-left:8px;opacity:0;transition:opacity .1s}
.showai-page-card:hover .showai-page-actions,.showai-page-actions:focus-within{opacity:1}
.showai-page-button{border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:6px;padding:1px 6px;font-size:11px;line-height:18px;text-decoration:none;white-space:nowrap}
.showai-page-button:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}
.showai-page-frame{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);border-radius:12px;flex-direction:column;margin:4px 0 6px 4px;display:flex;overflow:hidden}
.showai-page-frame iframe{display:block;width:100%;border:0;background:#fff;flex:auto}
.showai-page-note{color:var(--dsw-alias-label-tertiary);margin:0;padding:10px 12px;font-size:12px;line-height:18px}
.showai-page-output{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;color:var(--dsw-alias-label-secondary);margin:0;padding:10px 12px;font:var(--dsw-font-markdown-code-block-small);overflow:auto}
.showai-page-visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}
.showai-page-tail{display:flex;flex-direction:column;gap:8px;margin:8px 0 4px}
.showai-page-tailCard{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base);flex-direction:column;display:flex;overflow:hidden}
.showai-page-tailHead{border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;gap:6px;min-width:0;padding:6px 10px;display:flex}
.showai-page-tailTitle{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:auto;font-size:13px;line-height:24px;overflow:hidden}
.showai-page-tailFrame{display:block;width:100%;border:0;background:#fff}
@media (prefers-reduced-motion:reduce){.showai-page-card[data-state=running] .showai-page-row:after{animation:none;display:none}}
`;
    const tagId = "@showai/dsh-showai/preview.css";

    function previewFile(callId) {
      return `${String(callId).replace(/[^A-Za-z0-9_-]/g, "_")}.html`;
    }

    function textOf(content) {
      if (!Array.isArray(content)) return undefined;
      const parts = [];
      for (const item of content) {
        if (item?.type === "text" && typeof item.text === "string") parts.push(item.text);
        else if (item !== undefined) parts.push(JSON.stringify(item));
      }
      return parts.length === 0 ? undefined : parts.join("\n");
    }

    function requestedSelection(block) {
      const raw =
        block !== null && typeof block === "object"
          ? (block.call?.argsRaw ?? block.argsRaw)
          : undefined;
      if (typeof raw !== "string" || raw.trim() === "") return false;
      try {
        const args = JSON.parse(raw);
        return Array.isArray(args?.blockIds) && args.blockIds.length > 0;
      } catch {
        return false;
      }
    }

    function previewModel(block) {
      const settled = block !== null && typeof block === "object" && "kind" in block;
      const state = !settled
        ? "running"
        : block.error?.code === "interrupted"
          ? "stopped"
          : block.isError
            ? "error"
            : "ok";
      const output = settled ? textOf(block.content) : undefined;
      let body;
      try {
        body = output === undefined ? undefined : JSON.parse(output);
      } catch {
        body = undefined;
      }
      const data =
        body?.ok === true && body.data !== null && typeof body.data === "object" ? body.data : undefined;
      const delivery =
        data?.delivery !== null && typeof data?.delivery === "object" ? data.delivery : undefined;
      const inlinePath = typeof delivery?.inline === "string" ? delivery.inline : undefined;
      const htmlPath = typeof delivery?.html === "string" ? delivery.html : undefined;
      const path = inlinePath ?? htmlPath;
      const errorMessage =
        state === "error"
          ? typeof body?.error?.message === "string"
            ? body.error.message
            : (output ?? "").split("\n")[0]
          : undefined;
      return {
        state,
        output,
        path,
        fullPath: htmlPath ?? inlinePath,
        title: typeof data?.title === "string" ? data.title : undefined,
        partial: requestedSelection(block),
        inlineAvailable: data?.display?.inlineAvailable === true,
        hasPage: state === "ok" && path !== undefined,
        errorMessage,
      };
    }

    function ShowAIPageCard(props) {
      const { block, callId, openFile, t } = props;
      const tr = typeof t === "function" ? t : (key) => key;
      const model = previewModel(block);
      const [open, setOpen] = React.useState(true);
      const [expanded, setExpanded] = React.useState(false);
      const [reload, setReload] = React.useState(0);
      const [probe, setProbe] = React.useState("idle");
      const url = `${ROUTE}/${encodeURIComponent(previewFile(callId))}`;
      const probeUrl = `${url}?probe=${reload}`;

      React.useEffect(() => {
        if (!model.hasPage) {
          setProbe("idle");
          return undefined;
        }
        const controller = new AbortController();
        let timer;
        let wake;
        let attempts = 0;
        setProbe("checking");
        const check = async () => {
          while (!controller.signal.aborted) {
            attempts += 1;
            try {
              const response = await fetch(probeUrl, {
                method: "HEAD",
                cache: "no-store",
                signal: controller.signal,
              });
              if (response.ok) {
                setProbe("ready");
                return;
              }
            } catch (error) {
              if (error?.name === "AbortError") return;
            }
            if (attempts >= 20) {
              setProbe("missing");
              return;
            }
            await new Promise((resolve) => {
              wake = resolve;
              timer = setTimeout(resolve, 250);
            });
          }
        };
        void check();
        return () => {
          controller.abort();
          clearTimeout(timer);
          wake?.();
        };
      }, [probeUrl, model.hasPage]);

      const status =
        model.state === "running"
          ? tr("row.running")
          : model.state === "error"
            ? tr("row.failed")
            : model.state === "stopped"
              ? tr("row.stopped")
              : null;
      const summary = model.errorMessage ?? model.title ?? callId;
      const expandable = model.state === "ok";
      const frameHeight = expanded ? EXPANDED_HEIGHT : `${COLLAPSED_HEIGHT}px`;
      const toggle = () => setOpen((value) => !value);

      return h(
        "div",
        { className: "showai-page-card", "data-tool": "showai-page", "data-state": model.state },
        h(
          "div",
          {
            className: "showai-page-row",
            "data-expandable": expandable || undefined,
            ...(expandable
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-expanded": open,
                  onClick: toggle,
                  onKeyDown: (event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    toggle();
                  },
                }
              : {}),
          },
          h(
            "span",
            { className: "showai-page-leading", "aria-hidden": true },
            h("span", { className: "showai-page-dot" }),
          ),
          status === null
            ? null
            : h("span", { className: "showai-page-visuallyHidden" }, status),
          h("span", { className: "showai-page-title" }, tr("row.title")),
          h("span", { className: "showai-page-sep", "aria-hidden": true }),
          h(
            "span",
            { className: "showai-page-summary", "data-error": model.errorMessage ? true : undefined },
            summary,
          ),
          model.state === "ok"
            ? h(
                "span",
                { className: "showai-page-summary", style: { flex: "none" } },
                model.partial ? tr("row.fragment") : tr("row.page"),
              )
            : null,
          h(
            "span",
            { className: "showai-page-actions", onClick: (event) => event.stopPropagation() },
            model.hasPage
              ? h(
                  "button",
                  {
                    type: "button",
                    className: "showai-page-button",
                    title: tr("action.reload"),
                    onClick: () => setReload((value) => value + 1),
                  },
                  tr("action.reload"),
                )
              : null,
            model.hasPage
              ? h(
                  "button",
                  {
                    type: "button",
                    className: "showai-page-button",
                    title: expanded ? tr("action.collapse") : tr("action.expand"),
                    onClick: () => setExpanded((value) => !value),
                  },
                  expanded ? tr("action.collapse") : tr("action.expand"),
                )
              : null,
            model.hasPage
              ? h(
                  "a",
                  {
                    className: "showai-page-button",
                    href: url,
                    target: "_blank",
                    rel: "noopener noreferrer",
                    title: tr("action.open"),
                  },
                  tr("action.open"),
                )
              : null,
            model.fullPath !== undefined && typeof openFile === "function"
              ? h(
                  "button",
                  {
                    type: "button",
                    className: "showai-page-button",
                    title: tr("action.openFile"),
                    onClick: () => openFile(model.fullPath),
                  },
                  tr("action.openFile"),
                )
              : null,
          ),
        ),
        open && model.hasPage
          ? h(
              "div",
              { className: "showai-page-frame", style: { height: frameHeight } },
              probe === "ready"
                ? h("iframe", {
                    key: `${reload}`,
                    src: `${url}?v=${reload}`,
                    title: model.title ?? tr("row.title"),
                    sandbox:
                      "allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads",
                    referrerPolicy: "no-referrer",
                    loading: "lazy",
                  })
                : h(
                    "p",
                    { className: "showai-page-note" },
                    probe === "checking" ? tr("preview.checking") : tr("preview.missing"),
                  ),
            )
          : null,
        open && !model.hasPage && model.output !== undefined
          ? h(
              "details",
              { className: "showai-page-frame" },
              h("summary", { className: "showai-page-note" }, tr("action.output")),
              h("pre", { className: "showai-page-output" }, model.output),
            )
          : null,
      );
    }

    const PRESENTATION_TOOL = /^mcp__[A-Za-z0-9_-]+__(?:page_present|render_document|show_component)$/;

    function presentationOf(message) {
      if (message === null || typeof message !== "object" || message.isError === true) return undefined;
      if (!Array.isArray(message.content)) return undefined;
      for (const block of message.content) {
        if (block?.type !== "text" || typeof block.text !== "string") continue;
        let body;
        try {
          body = JSON.parse(block.text);
        } catch {
          continue;
        }
        const data = body?.ok === true ? body.data : undefined;
        const delivery = data?.delivery;
        if (delivery === null || typeof delivery !== "object") continue;
        if (typeof delivery.inline !== "string" && typeof delivery.html !== "string") continue;
        return {
          title: typeof data.title === "string" ? data.title : undefined,
          fullPath: typeof delivery.html === "string" ? delivery.html : delivery.inline,
        };
      }
      return undefined;
    }

    const showaiPageDefinition = {
      kind: "showai-page",
      match: (event) => {
        if (event.type === "turn/start") return { id: String(event.data.turn), role: "start" };
        if (event.type === "tool/call" || event.type === "tool/result") {
          return { id: String(event.data.turn), role: "update" };
        }
        return null;
      },
      start: (_context, match) => ({ turn: match.event.data.turn, calls: new Map(), pages: [] }),
      update: (context, match) => {
        if (match.event.type === "tool/call") {
          const calls = new Map(context.state.calls);
          calls.set(String(match.event.data.callId), String(match.event.data.name ?? ""));
          return { ...context.state, calls };
        }
        if (match.event.type !== "tool/result") return context.state;
        const message = match.event.data.message;
        const callId = message === null || typeof message !== "object" ? "" : String(message.source?.callId ?? "");
        if (callId === "") return context.state;
        if (!PRESENTATION_TOOL.test(context.state.calls.get(callId) ?? "")) return context.state;
        const presentation = presentationOf(message);
        if (presentation === undefined) return context.state;
        const pages = context.state.pages.filter((page) => page.callId !== callId);
        pages.push({ callId, title: presentation.title, fullPath: presentation.fullPath, seq: match.event.seq });
        return { ...context.state, pages };
      },
      buildLocationData: (context, scope, previous) => {
        if (scope !== "turn" || context.state === undefined) return null;
        if (
          previous?.kind === "turn" &&
          previous.turn === context.state.turn &&
          previous.key === "showai-page" &&
          previous.value.pages === context.state.pages
        ) {
          return previous;
        }
        return {
          kind: "turn",
          turn: context.state.turn,
          key: "showai-page",
          value: { pages: context.state.pages },
        };
      },
    };

    function ShowAIPageTail(props) {
      const { turn, seq, openFile } = props;
      const tr = typeof props.t === "function" ? props.t : (key) => key;
      const state = turn?.data?.get?.("showai-page");
      const pages = (Array.isArray(state?.pages) ? state.pages : []).filter((page) => page.seq < seq);
      return pages.length === 0
        ? null
        : h(
            "div",
            { className: "showai-page-tail" },
            pages.map((page) => h(ShowAIPageTailCard, { key: page.callId, page, openFile, tr })),
          );
    }

    function ShowAIPageTailCard({ page, openFile, tr }) {
      const [open, setOpen] = React.useState(true);
      const [expanded, setExpanded] = React.useState(false);
      const [reload, setReload] = React.useState(0);
      const url = `${ROUTE}/${encodeURIComponent(previewFile(page.callId))}`;
      const title = page.title ?? tr("row.title");
      return h(
        "div",
        { className: "showai-page-tailCard", "data-showai-tail": page.callId },
        h(
          "div",
          { className: "showai-page-tailHead" },
          h("span", { className: "showai-page-dot", "aria-hidden": true }),
          h("span", { className: "showai-page-tailTitle", title }, title),
          h(
            "span",
            { className: "showai-page-actions", style: { opacity: "1" } },
            open
              ? h(
                  "button",
                  {
                    type: "button",
                    className: "showai-page-button",
                    onClick: () => setReload((value) => value + 1),
                  },
                  tr("action.reload"),
                )
              : null,
            open
              ? h(
                  "button",
                  {
                    type: "button",
                    className: "showai-page-button",
                    onClick: () => setExpanded((value) => !value),
                  },
                  expanded ? tr("action.collapse") : tr("action.expand"),
                )
              : null,
            h(
              "a",
              { className: "showai-page-button", href: url, target: "_blank", rel: "noopener noreferrer" },
              tr("action.open"),
            ),
            typeof page.fullPath === "string" && typeof openFile === "function"
              ? h(
                  "button",
                  { type: "button", className: "showai-page-button", onClick: () => openFile(page.fullPath) },
                  tr("action.openFile"),
                )
              : null,
            h(
              "button",
              {
                type: "button",
                className: "showai-page-button",
                "aria-expanded": open,
                onClick: () => setOpen((value) => !value),
              },
              open ? tr("action.hide") : tr("action.show"),
            ),
          ),
        ),
        open
          ? h("iframe", {
              key: `${page.callId}:${reload}`,
              className: "showai-page-tailFrame",
              style: { height: expanded ? EXPANDED_HEIGHT : `${TAIL_HEIGHT}px` },
              src: `${url}?v=${reload}`,
              title,
              sandbox:
                "allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads",
              referrerPolicy: "no-referrer",
              loading: "lazy",
            })
          : null,
      );
    }

    return {
      inject: ["slots", "locale", "uiConversation"],
      apply(ctx) {
        ctx.effect(() => {
          if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) === null) {
            const tag = document.createElement("style");
            tag.dataset.plugin = "@showai/dsh-showai";
            tag.dataset.pluginCss = tagId;
            tag.textContent = css;
            document.head.appendChild(tag);
          }
          return () => {
            document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`)?.remove();
          };
        }, "showai-page: styles");
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), "showai-page: dictionaries");
        const conversation =
          ctx.uiConversation ?? (typeof ctx.get === "function" ? ctx.get("uiConversation") : undefined);
        if (conversation?.events !== undefined) {
          ctx.effect(() => {
            const dispose = conversation.events.register(showaiPageDefinition);
            return typeof dispose === "function" ? dispose : () => {};
          }, "showai-page: turn records");
          ctx.slots.inject("conversation.chat.turnTail", () =>
            ctx.slots.register(
              { name: "conversation.chat.turnTail", id: "@showai/dsh-showai/page-tail", locale: NS },
              ShowAIPageTail,
            ),
          );
        }
        for (const key of TOOLS) {
          ctx.slots.inject("tool.call.toolview", () =>
            ctx.slots.register({ name: "tool.call.toolview", key, locale: NS }, ShowAIPageCard),
          );
        }
      },
    };
  },
});
