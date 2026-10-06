import "./style.css";
import { catalog, groups } from "./catalog.js";
import { createContext, themes } from "./runtime.js";
import drawKagi from "./kagi.js";

const draws = import.meta.glob("./samples/*.js", {
  eager: true,
  import: "default",
});
const contexts = new Map();
let activeTheme = "indigo";
let activeGroup = "全部";
let search = "";
let detailContext;
let shownEntry;
let busy = false;

document.querySelector("#app").innerHTML = `
  <header><div class="brand"><b>G2</b> SHOWAI · 图表样式探索</div><div class="headline"><div><h1>43 类图表，直接看样式。</h1><p>用 G2 实际绘制，切换统一主题，比较常规图、统计分布、关系与地图。点击图名进入大图，体验提示与交互。</p></div><div class="count">43<small>代表类型 · G2 5.4.8</small></div></div></header>
  <div class="controls"><div class="control-row"><div class="themes" role="group" aria-label="图表主题">${Object.entries(
    themes,
  )
    .map(
      ([id, t]) =>
        `<button type="button" data-theme="${id}" aria-pressed="${id === activeTheme}">${t.label}</button>`,
    )
    .join(
      "",
    )}</div><label class="search"><input aria-label="搜索图表" placeholder="搜索图表名称、用途…" type="search" /></label></div><nav class="tabs" aria-label="图表分类">${["全部", ...groups].map((g) => `<button type="button" data-group="${g}" aria-pressed="${g === "全部"}">${g} <span>${g === "全部" ? 43 : catalog.filter((e) => e.group === g).length}</span></button>`).join("")}</nav><div class="status" role="status" aria-live="polite"><span class="dot"></span><span id="status-text">正在绘制图表…</span></div></div>
  <main><div class="grid">${catalog.map((entry) => `<article class="card" data-chart-id="${entry.id}"><div class="card-head"><button type="button" class="title-button" data-open="${entry.id}" aria-label="放大${entry.name}"><h2>${entry.name}</h2><p class="english">${entry.english}</p></button><span class="badge">${entry.implementation}</span></div><div class="plot" id="plot-${entry.id}" aria-label="${entry.name}图表"><div class="loading">绘制中…</div></div><div class="card-bottom"><p class="description">${entry.description}</p><button type="button" class="expand" data-open="${entry.id}">查看大图 ↗</button></div></article>`).join("")}</div><div class="no-results" hidden>没有匹配的图表，请调整搜索条件。</div></main>
  <footer class="footer">示例改编自 <a href="https://g2.antv.antgroup.com/en/charts/overview" target="_blank" rel="noreferrer">G2 官方 43 类图表目录</a>，包含真实公开数据与上游演示数据，仅用于比较图形样式。主题切换保持示例输入一致。<br>“官方扩展”使用 G2 plot 扩展；Kagi 根据官方概念说明，用 G2 基础图形和转向算法组合实现。示例资源已打包到本地，图表运行不请求外部数据。</footer>
  <dialog aria-label="图表大图"><div class="dialog-head"><div><h2 id="detail-title"></h2><span id="detail-kind" class="badge"></span></div><button type="button" class="close">关闭</button></div><div class="detail-plot" id="detail-plot"></div><p class="detail-meta" id="detail-note"></p><div class="detail-actions"><button type="button" class="download" disabled>下载 SVG</button><a id="detail-docs" target="_blank" rel="noreferrer">官方图表说明 ↗</a><a id="detail-source" target="_blank" rel="noreferrer">上游示例源码 ↗</a></div></dialog>
`;
const dialog = document.querySelector("dialog");
const status = document.querySelector("#status-text");

function applyFilters() {
  let visible = 0;
  catalog.forEach((entry) => {
    const match =
      (activeGroup === "全部" || entry.group === activeGroup) &&
      `${entry.name} ${entry.english} ${entry.description}`
        .toLowerCase()
        .includes(search);
    document.querySelector(`[data-chart-id="${entry.id}"]`).hidden = !match;
    if (match) visible += 1;
  });
  document.querySelector(".no-results").hidden = visible > 0;
  if (!busy)
    status.textContent = `已绘制 ${contexts.size} 类 · 当前显示 ${visible} / 43 · 点击图名查看大图`;
}

async function renderEntry(entry, container, expanded = false) {
  container.replaceChildren();
  const context = createContext(container, entry, activeTheme, expanded);
  // This is the renderer/I/O boundary. Errors stay visible instead of substituting another chart.
  try {
    const draw =
      entry.id === "kagi" ? drawKagi : draws[`./samples/${entry.id}.js`];
    await draw(context);
    await context.flush();
    if (!container.querySelector("svg")) throw new Error("G2 未生成 SVG 画布");
    container.dataset.rendered = "true";
    return context;
  } catch (error) {
    context.destroy();
    container.dataset.rendered = "error";
    const message = document.createElement("pre");
    message.className = "error";
    message.textContent = `绘制失败：${error.message}`;
    container.append(message);
    console.error(`${entry.id}:`, error);
    throw error;
  }
}

async function renderAll() {
  busy = true;
  document.querySelectorAll("[data-theme]").forEach((b) => (b.disabled = true));
  contexts.forEach((context) => context.destroy());
  contexts.clear();
  const errors = [];
  for (const entry of catalog) {
    status.textContent = `正在绘制 ${entry.index + 1} / 43：${entry.name}`;
    try {
      contexts.set(
        entry.id,
        await renderEntry(entry, document.querySelector(`#plot-${entry.id}`)),
      );
    } catch (error) {
      errors.push({ id: entry.id, message: error.message });
    }
  }
  busy = false;
  document
    .querySelectorAll("[data-theme]")
    .forEach((b) => (b.disabled = false));
  document.body.dataset.ready = "true";
  document.body.dataset.errors = String(errors.length);
  applyFilters();
  if (errors.length) {
    status.classList.add("error-summary");
    status.textContent = `${contexts.size} 类绘制完成，${errors.length} 类失败；失败原因显示在对应卡片。`;
  } else status.classList.remove("error-summary");
}

async function openDetail(id) {
  shownEntry = catalog.find((e) => e.id === id);
  if (detailContext) detailContext.destroy();
  const entry = shownEntry;
  document.querySelector("#detail-title").textContent = entry.name;
  document.querySelector("#detail-kind").textContent = entry.implementation;
  document.querySelector("#detail-note").textContent =
    entry.id === "kagi"
      ? "自定义组合：复用官方 K 线示例的收盘值，按 2% 反转阈值生成转向线。该实现展示 Kagi 形态，不是 G2 的内置 Kagi 类型。"
      : `${entry.description}。示例来自官方图表文档，数据已本地打包；大图保留示例中的图例与标签。`;
  document.querySelector("#detail-docs").href = entry.docs;
  document.querySelector("#detail-source").href = entry.source;
  const download = document.querySelector(".download");
  download.disabled = true;
  dialog.showModal();
  detailContext = await renderEntry(
    entry,
    document.querySelector("#detail-plot"),
    true,
  );
  download.disabled = false;
}

document.querySelectorAll("[data-theme]").forEach((button) =>
  button.addEventListener("click", async () => {
    activeTheme = button.dataset.theme;
    document.body.classList.toggle("dark", activeTheme === "dark");
    document
      .querySelectorAll("[data-theme]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    await renderAll();
  }),
);
document.querySelectorAll("[data-group]").forEach((button) =>
  button.addEventListener("click", () => {
    activeGroup = button.dataset.group;
    document
      .querySelectorAll("[data-group]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    applyFilters();
  }),
);
document.querySelector("input").addEventListener("input", (event) => {
  search = event.target.value.trim().toLowerCase();
  applyFilters();
});
document
  .querySelectorAll("[data-open]")
  .forEach((button) =>
    button.addEventListener("click", () => openDetail(button.dataset.open)),
  );
document
  .querySelector(".close")
  .addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => {
  if (detailContext) detailContext.destroy();
  detailContext = undefined;
});
document.querySelector(".download").addEventListener("click", () => {
  const svg = document.querySelector("#detail-plot svg");
  const copy = svg.cloneNode(true);
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const blob = new Blob([new XMLSerializer().serializeToString(copy)], {
    type: "image/svg+xml",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `g2-${shownEntry.id}-${activeTheme}.svg`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

await renderAll();
