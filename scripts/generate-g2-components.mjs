/** Extract editable defaults from the reviewed upstream examples; no rendering is simulated. */
import { readFile, writeFile } from "node:fs/promises";
import { csvParse, autoType } from "@antv/vendor/d3-dsv";
import { catalog } from "../src/components/blocks/g2/catalog.js";
const cache = JSON.parse(
  await readFile(
    new URL("../examples/g2-style-gallery/data-cache.json", import.meta.url),
    "utf8",
  ),
);
const templates = [];
const asset = (url) =>
  cache[url].base64
    ? `data:${cache[url].mime};base64,${cache[url].content}`
    : `data:${cache[url].mime},${encodeURIComponent(cache[url].content)}`;
const keyForUrl = (url) =>
  url
    .split("/")
    .pop()
    .replace(/\.(json|csv|png)$/, "");
for (const entry of catalog) {
  let captured;
  class CaptureSpec {
    options(spec) {
      captured = spec;
    }
    render() {
      return Promise.resolve();
    }
  }
  let seed = 7;
  const math = Object.create(Math);
  math.random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const draw = (
    await import(
      entry.id === "kagi"
        ? "../src/components/blocks/g2/kagi.js"
        : `../src/components/blocks/g2/samples/${entry.id}.js`
    )
  ).default;
  await draw({
    Chart: CaptureSpec,
    asset,
    math,
    fetch: globalThis.fetch,
    datasets: { main: [7.57, 7.8, 8.15, 8.41, 8.7, 8.37, 8.09, 8.32] },
    flush: async () => {},
    textColor: "#333",
  });
  const datasets = {};
  for (const url of [
    ...new Set(
      (
        await readFile(
          new URL(
            entry.id === "kagi"
              ? "../src/components/blocks/g2/kagi.js"
              : `../src/components/blocks/g2/samples/${entry.id}.js`,
            import.meta.url,
          ),
          "utf8",
        )
      ).match(/https?:\/\/[^"\s)]+\.(?:json|csv)/g) || [],
    ),
  ]) {
    if (!cache[url]) continue;
    if (["dot-map", "bubble-map", "choropleth-map"].includes(entry.id))
      datasets[keyForUrl(url)] = JSON.parse(cache[url].content);
  }
  const visit = (spec, path = "main") => {
    if (spec.type === "image") return;
    const value = spec.data;
    if (value?.type === "fetch") {
      const raw = Object.values(cache).find(
        (c) =>
          asset(Object.keys(cache).find((k) => cache[k] === c)) === value.value,
      );
      if (!raw) throw new Error(`Unknown example resource: ${entry.id}`);
      datasets[path] =
        raw.mime === "text/csv"
          ? csvParse(raw.content, autoType)
          : JSON.parse(raw.content);
    } else if (Array.isArray(value)) datasets[path] = value;
    else if (
      value &&
      typeof value === "object" &&
      Object.hasOwn(value, "value")
    )
      datasets[path] = value.value;
    else if (value && typeof value === "object" && !value.transform)
      datasets[path] = value;
    spec.children?.forEach((child, index) => visit(child, `layer-${index}`));
  };
  visit(captured);
  if (entry.id === "kagi") {
    for (const key of Object.keys(datasets)) delete datasets[key];
    datasets.main = [7.57, 7.8, 8.15, 8.41, 8.7, 8.37, 8.09, 8.32];
  }
  if (entry.id === "dot-map") {
    delete datasets.main;
    delete datasets["layer-0"];
    delete datasets["layer-1"];
    datasets.airports = datasets.airports.filter(
      (_, index) => index % 10 === 0,
    );
  }
  if (entry.id === "bubble-map" || entry.id === "choropleth-map") {
    delete datasets.main;
    for (const key of Object.keys(datasets))
      if (key.startsWith("layer-")) delete datasets[key];
  }
  // Keep insertion defaults small. All values remain upstream samples; simplify only geometry.
  for (const [key, value] of Object.entries(datasets)) {
    if (Array.isArray(value) && value.length > 300 && key !== "unemployment2")
      datasets[key] = value.filter(
        (_, i) =>
          i % Math.ceil(value.length / 300) === 0 || i === value.length - 1,
      );
    if (value?.type === "Topology") {
      const copy = structuredClone(value);
      copy.arcs = copy.arcs.map((arc) => {
        let x = 0,
          y = 0;
        const points = arc.map(([dx, dy]) => [(x += dx), (y += dy)]);
        const kept = points.filter(
          (_, i) => i % 4 === 0 || i === points.length - 1,
        );
        let px = 0,
          py = 0;
        return kept.map(([a, b]) => {
          const d = [a - px, b - py];
          px = a;
          py = b;
          return d;
        });
      });
      if (key === "us-10m") {
        copy.objects = { states: copy.objects.states };
        const used = new Set();
        const collect = (v) => {
          if (Array.isArray(v)) v.forEach(collect);
          else if (typeof v === "number") used.add(v < 0 ? -v - 1 : v);
        };
        copy.objects.states.geometries.forEach((g) => collect(g.arcs));
        const ids = [...used].sort((a, b) => a - b);
        const lookup = new Map(ids.map((v, i) => [v, i]));
        const remap = (v) =>
          Array.isArray(v)
            ? v.map(remap)
            : v < 0
              ? -lookup.get(-v - 1) - 1
              : lookup.get(v);
        copy.objects.states.geometries.forEach((g) => (g.arcs = remap(g.arcs)));
        copy.arcs = ids.map((i) => copy.arcs[i]);
      }
      datasets[key] = copy;
    }
  }
  if (entry.id === "choropleth-map") {
    const states = new Map();
    for (const row of datasets.unemployment2) {
      const id = Math.floor(row.id / 1000);
      const item = states.get(id) ?? {
        id,
        state: row.state,
        total: 0,
        count: 0,
      };
      item.total += row.rate;
      item.count++;
      states.set(id, item);
    }
    datasets.unemployment2 = [...states.values()].map((v) => ({
      id: v.id,
      state: v.state,
      rate: Number((v.total / v.count).toFixed(2)),
    }));
  }
  const defaultData = {
    title: entry.name,
    ...(entry.id === "choropleth-map"
      ? { description: "示例为州内县失业率的未加权平均值；边界已简化。" }
      : {}),
    datasets,
    theme: "indigo",
    height: 320,
    legend:
      !["sunburst", "gauge", "pack", "venn", "sankey"].includes(entry.id) &&
      captured.legend !== false,
    animation: false,
    fields: {},
    appearance: {},
    interaction: { tooltip: true, legendFilter: true },
  };
  const kind = "g2-" + entry.id;
  const propsSchema = {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      datasets: {
        type: "object",
        minProperties: 1,
        additionalProperties: { type: ["array", "object"] },
      },
      theme: { enum: ["indigo", "classic", "dark"] },
      height: { type: "number", minimum: 200, maximum: 900 },
      legend: { type: "boolean" },
      animation: { type: "boolean" },
      fields: { type: "object", additionalProperties: { type: "string" } },
      appearance: {
        type: "object",
        properties: {
          palette: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
          },
          fontSize: { type: "number", minimum: 8, maximum: 32 },
          lineWidth: { type: "number", minimum: 0, maximum: 12 },
          opacity: { type: "number", minimum: 0, maximum: 1 },
        },
        additionalProperties: false,
      },
      interaction: {
        type: "object",
        properties: Object.fromEntries(
          [
            "tooltip",
            "elementHighlight",
            "elementSelect",
            "brushHighlight",
            "brushFilter",
            "legendFilter",
          ].map((key) => [key, { type: "boolean" }]),
        ),
        additionalProperties: false,
      },
    },
    required: ["datasets"],
    additionalProperties: false,
  };
  templates.push({
    kind,
    name: entry.name,
    description: entry.description + "，支持编辑数据、主题和交互。",
    scenarios: [entry.description, "按统一视觉规范创建可复用的数据图表。"],
    effects: [
      "数据与样式修改保存为页面源文件。",
      "支持图例筛选、提示与选中反馈，离线 HTML 保留交互。",
    ],
    defaultData,
    propsSchema,
    examples: [
      {
        name: "官方样式示例",
        request: "插入" + entry.name + "并用自己的数据替换示例。",
        data: defaultData,
      },
    ],
    version: "1.0.0",
  });
}
await writeFile(
  new URL("../resources/catalog/g2.json", import.meta.url),
  JSON.stringify(templates) + "\n",
);
const names = catalog.map((e) => ({
  id: e.id,
  name:
    "G2" +
    e.id
      .split("-")
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(""),
}));
await writeFile(
  new URL("../src/components/blocks/g2/exports.tsx", import.meta.url),
  'import {G2ChartBlock} from "../G2Chart";\nimport type {BlockProps} from "../types";\n' +
    names
      .map(
        (e) =>
          `export function ${e.name}(props:BlockProps){return <G2ChartBlock {...props} chartType="${e.id}"/>}`,
      )
      .join("\n"),
);
await writeFile(
  new URL("../src/components/blocks/g2/exports-map.json", import.meta.url),
  JSON.stringify(
    Object.fromEntries(names.map((e) => ["g2-" + e.id, e.name])),
    null,
    2,
  ),
);
await writeFile(
  new URL("../src/components/blocks/g2/draws.js", import.meta.url),
  catalog
    .map(
      (e) =>
        `import ${e.id.replaceAll("-", "_")} from '${e.id === "kagi" ? "./kagi.js" : "./samples/" + e.id + ".js"}';`,
    )
    .join("\n") +
    "\nexport const draws={" +
    catalog
      .map((e) => JSON.stringify(e.id) + ":" + e.id.replaceAll("-", "_"))
      .join(",") +
    "};\n",
);
console.log(`Prepared ${templates.length} G2 component definitions.`);
