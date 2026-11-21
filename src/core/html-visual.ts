import { componentSandboxPolicy } from "../contract/sandbox-policy.mjs";

export interface HtmlVisual {
  html: string;
  title?: string;
  data?: Record<string, unknown>;
}

function scriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const measure = `
(() => {
function reportSize() {
  const height = Math.ceil(Math.max(document.body.getBoundingClientRect().height, document.body.scrollHeight));
  parent.postMessage({ type: "showai:html-visual-size", height }, "*");
}
window.addEventListener("DOMContentLoaded", () => {
  new ResizeObserver(reportSize).observe(document.body);
  document.documentElement.dataset.showaiHtmlReady = "true";
  reportSize();
});
})();`;

const head = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${componentSandboxPolicy}"><style>:root{color-scheme:light dark}body{display:flow-root;margin:0;font:14px/1.5 system-ui,sans-serif}*,*::before,*::after{box-sizing:border-box}button,input,select,textarea{font:inherit}</style><script>${measure}window.showaiData=`;

const element = `
if (!customElements.get("showai-html-visual")) {
  customElements.define("showai-html-visual", class extends HTMLElement {
    constructor() {
      super();
      this.frame = document.createElement("iframe");
      this.frame.setAttribute("sandbox", "allow-scripts");
      this.frame.setAttribute("data-showai-html-frame", "");
      this.frame.style.cssText = "display:block;width:100%;height:1px;border:0";
      this.attachShadow({mode:"open"}).append(this.frame);
      this.resize = event => {
        if (event.source !== this.frame.contentWindow || event.data?.type !== "showai:html-visual-size") return;
        const height = event.data.height;
        if (Number.isFinite(height) && height >= 0) this.frame.style.height = Math.max(1, Math.min(32000, height)) + "px";
      };
    }
    connectedCallback() {
      this.style.display = "block";
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
      if (this.frame.getAttribute("srcdoc") !== source) this.frame.srcdoc = source;
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
