/**
 * ShowAI inline page preview — Client half.
 *
 * Registers the dedicated Tool call view for the ShowAI presentation tools, so
 * a presented page renders inside the conversation instead of collapsing into
 * the generic JSON card. The page itself is not on the wire: the Host half
 * caches the delivered HTML and serves it from an isolated loopback origin, and
 * this half only builds the address and frames it.
 *
 * Rendering an externally produced HTML document is the one case where a frame
 * is the right surface (a ShowAI page is a whole interactive application with
 * its own runtime, not markup this plugin could re-render as React). Isolation
 * comes from the origin split the Host half owns: the frame is a different
 * origin from the Harness page, so its scripts cannot read the application DOM
 * or `/api`, while it keeps a real origin of its own for storage and workers.
 */
window.__ModuleLoader__.load({
  id: "@showai/dsh-showai",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;

    /** Locale namespace owned by this plugin. */
    const NS = "showai-page";
    /** Same-origin Host route; the Host answers the probe and redirects the load. */
    const ROUTE = "/showai-page-preview";
    /** Wire tools this view takes over. */
    const TOOLS = ["mcp__showai__page_present", "mcp__showai__render_document"];
    /** Frame heights: the inline seat, and the expanded seat. */
    const COLLAPSED_HEIGHT = 420;
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
    };

    /** Styles use theme tokens only, so light and dark follow the host. */
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
@media (prefers-reduced-motion:reduce){.showai-page-card[data-state=running] .showai-page-row:after{animation:none;display:none}}
`;
    const tagId = "@showai/dsh-showai/preview.css";

    /**
     * The preview file name rule shared with the Host half (`index.js`).
     * @param callId - the tool call id owning the preview.
     * @returns the cache file name the Host serves.
     */
    function previewFile(callId) {
      return `${String(callId).replace(/[^A-Za-z0-9_-]/g, "_")}.html`;
    }

    /**
     * Flatten the durable result blocks under the generic Tool-row text contract.
     * @param content - the settled result content blocks.
     * @returns the joined text, or undefined when there is none.
     */
    function textOf(content) {
      if (!Array.isArray(content)) return undefined;
      const parts = [];
      for (const item of content) {
        if (item?.type === "text" && typeof item.text === "string") parts.push(item.text);
        else if (item !== undefined) parts.push(JSON.stringify(item));
      }
      return parts.length === 0 ? undefined : parts.join("\n");
    }

    /**
     * Whether the presentation asked for a block selection rather than the whole
     * Page. `delivery.inline` is only the inline build, not by itself a sign of a
     * partial render, so the call arguments are the authoritative signal.
     * @param block - the frozen running or settled Tool call node.
     * @returns true when the call carried a non-empty `blockIds` selection.
     */
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

    /**
     * Fold one call slice into everything the row and the frame need.
     * @param block - the frozen running or settled Tool call node.
     * @returns the presentation model.
     */
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

    /**
     * Render one ShowAI presentation call: a status row, then the framed page.
     * @param props - the keyed toolview payload plus the locale seat.
     * @returns the dedicated ShowAI page card.
     */
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
            // The Host caches the preview asynchronously, so a page presented
            // just now can legitimately be absent for the first probe or two.
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

    return {
      inject: ["slots", "locale"],
      /**
       * Register the dictionaries and the two keyed Tool views.
       * @param ctx - the client plugin context.
       */
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
        for (const key of TOOLS) {
          ctx.slots.inject("tool.call.toolview", () =>
            ctx.slots.register({ name: "tool.call.toolview", key, locale: NS }, ShowAIPageCard),
          );
        }
      },
    };
  },
});
