import { componentSandboxPolicy } from "../contract/sandbox-policy.mjs";

export interface HtmlVisual {
  html: string;
  title?: string;
  data?: Record<string, unknown>;
}

function scriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const paint = `function nextPaint(callback) {
    let frame;
    const timer = setTimeout(finish, 120);
    function finish() {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      callback();
    }
    frame = requestAnimationFrame(finish);
  }`;

const measure = `
(() => {
  ${paint}
  let painting = false;
  const revision = document.documentElement.dataset.showaiRevision;
  function height() {
    const body = document.body;
    return Math.max(1, Math.min(32000, Math.ceil(Math.max(body.getBoundingClientRect().height, body.scrollHeight))));
  }
  function report(resized = false) {
    const measured = height();
    parent.postMessage({type:"showai:html-visual-size", revision, height:measured}, "*");
    if (document.documentElement.dataset.showaiHtmlReady || painting || (!resized && innerHeight !== measured)) return;
    painting = true;
    delete document.documentElement.dataset.showaiMeasuring;
    nextPaint(() => {
      nextPaint(() => {
        parent.postMessage({type:"showai:html-visual-ready", revision}, "*");
      });
    });
  }
  window.addEventListener("message", event => {
    if (event.source === parent && event.data?.revision === revision && event.data?.type === "showai:html-visual-presented")
      document.documentElement.dataset.showaiHtmlReady = "true";
  });
  window.addEventListener("DOMContentLoaded", () => {
    new ResizeObserver(() => report()).observe(document.body);
    window.addEventListener("resize", () => report(true));
    report();
  });
})();`;

const head = `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${componentSandboxPolicy}"><style>html[data-showai-measuring] body{opacity:0}:root{color-scheme:light dark}body{display:flow-root;margin:0;font:14px/1.5 system-ui,sans-serif}*,*::before,*::after{box-sizing:border-box}button,input,select,textarea{font:inherit}</style><script>${measure}window.showaiData=`;

const element = `
if (!customElements.get("showai-html-visual")) {
  ${paint}
  customElements.define("showai-html-visual", class extends HTMLElement {
    constructor() {
      super();
      this.revision = 0;
      this.frame = document.createElement("iframe");
      this.frame.setAttribute("sandbox", "allow-scripts");
      this.frame.setAttribute("data-showai-html-frame", "");
      this.frame.style.cssText = "display:block;width:100%;height:1px;border:0";
      this.resize = event => {
        if (event.source !== this.frame.contentWindow || event.data?.revision !== String(this.revision)) return;
        if (event.data?.type === "showai:html-visual-ready") {
          const frame = this.frame;
          const revision = event.data.revision;
          nextPaint(() => nextPaint(() => {
            if (!frame.isConnected || revision !== String(this.revision)) return;
            this.removeAttribute("data-preview-pending");
            frame.contentWindow.postMessage({type:"showai:html-visual-presented", revision}, "*");
          }));
          return;
        }
        if (event.data?.type !== "showai:html-visual-size") return;
        const height = event.data.height;
        if (Number.isFinite(height) && height >= 0) this.frame.style.height = Math.max(1, Math.min(32000, height)) + "px";
      };
    }
    connectedCallback() {
      this.style.display = "block";
      if (this.frame.parentNode !== this) this.append(this.frame);
      window.addEventListener("message", this.resize);
      const input = this.getAttribute("data-visual");
      if (input) this.show(JSON.parse(input));
    }
    disconnectedCallback() {
      window.removeEventListener("message", this.resize);
    }
    show(input) {
      this.frame.title = input.title || "Visualization";
      const data = JSON.stringify(JSON.stringify(input.data ?? {})).replace(/</g, "\\\\u003c");
      const source = ${scriptJson(head)} + "JSON.parse(" + data + ");</" + "script></head><body>" + input.html + "</body></html>";
      if (this.source !== source) {
        this.source = source;
        this.revision++;
        this.setAttribute("data-preview-pending", "true");
        this.frame.srcdoc = '<!doctype html><html data-showai-measuring data-showai-revision="' + this.revision + '">' + source;
      }
    }
  });
}`;

export function htmlVisualFragment(visuals: HtmlVisual[]) {
  const frames = visuals.map((visual) => {
    const attribute = scriptJson(visual)
      .replace(/&/g, "&amp;")
      .replace(/'/g, "&#39;");
    return `<showai-html-visual data-visual='${attribute}'></showai-html-visual>`;
  });
  return `<meta charset="utf-8"><div data-showai-html-visuals style="display:grid;gap:12px">${frames.join("\n")}</div><script>${element}</script>`;
}

export function htmlVisualModule(html: string, title: string) {
  return `import React, {useLayoutEffect, useRef} from "react";
${element}
const html = ${scriptJson(html)};
export default function HtmlVisual({data}) {
  const view = useRef(null);
  useLayoutEffect(() => { view.current.show({html, data, title: ${scriptJson(title)}}); }, [data]);
  return <showai-html-visual ref={view}/>;
}`;
}
