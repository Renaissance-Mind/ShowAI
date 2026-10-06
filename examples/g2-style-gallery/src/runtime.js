import { Runtime, stdlib, extend } from "@antv/g2";
import { plotlib } from "@antv/g2-extension-plot";
import { Renderer as SVGRenderer } from "@antv/g-svg";
import assetCache from "../data-cache.json";

const BaseChart = extend(Runtime, { ...stdlib(), ...plotlib() });
export const themes = {
  indigo: {
    label: "ShowAI 靛蓝",
    base: "classic",
    palette: [
      "#120A8F",
      "#6653CF",
      "#9A89ED",
      "#D0C9F4",
      "#EA8A3B",
      "#53A7A1",
      "#A6629E",
      "#7485AB",
      "#ADC487",
      "#B9B5C8",
    ],
  },
  classic: {
    label: "G2 经典",
    base: "classic",
    palette: [
      "#1783FF",
      "#00C9C9",
      "#F0884D",
      "#D580FF",
      "#7863FF",
      "#60C42D",
      "#BD8F24",
      "#FF80CA",
      "#2491B3",
      "#17C76F",
    ],
  },
  dark: {
    label: "深色",
    base: "classicDark",
    palette: [
      "#A99CFF",
      "#69D6D0",
      "#FFA762",
      "#CF98DE",
      "#709EF2",
      "#B0CB77",
      "#F2919A",
      "#89BBD2",
      "#D2BF91",
      "#A6ABBC",
    ],
  },
};
const encodedAssets = new Map();
export function asset(url) {
  const cached = assetCache[url];
  if (!cached) throw new Error(`未打包的示例资源：${url}`);
  if (!encodedAssets.has(url)) {
    encodedAssets.set(
      url,
      cached.base64
        ? `data:${cached.mime};base64,${cached.content}`
        : `data:${cached.mime};charset=utf-8,${encodeURIComponent(cached.content)}`,
    );
  }
  return encodedAssets.get(url);
}

function stableMath(id) {
  let seed = [...id].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
  const math = Object.create(Math);
  math.random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return math;
}

function adaptSpec(input, theme, expanded, root = true) {
  const spec = { ...input, animate: false };
  if (spec.data?.type === "fetch" && spec.data.value?.startsWith("data:")) {
    spec.data = {
      ...spec.data,
      format: spec.data.value.startsWith("data:text/csv") ? "csv" : "json",
    };
  }
  delete spec.width;
  delete spec.height;
  delete spec.autoFit;
  if (root) {
    spec.theme = {
      type: theme.base,
      color: theme.palette[0],
      category10: theme.palette,
    };
    spec.paddingLeft = expanded ? 55 : 38;
    spec.paddingRight = expanded ? 35 : 18;
    spec.paddingTop = 20;
    spec.paddingBottom = expanded ? 48 : 35;
  }
  // Dense legends and demonstration labels are available in the larger view.
  if (!expanded) {
    spec.legend = false;
    if (spec.labels) spec.labels = [];
    if (["sankey", "pack", "treemap"].includes(spec.type))
      spec.style = { ...spec.style, labelText: "" };
  }
  if (spec.axis !== false) {
    const defaults = {
      title: false,
      labelFontSize: expanded ? 12 : 10,
      labelAutoHide: true,
      tickCount: expanded ? 6 : 4,
    };
    spec.axis = Object.fromEntries(
      ["x", "y"].map((key) => [
        key,
        spec.axis?.[key] === false
          ? false
          : {
              ...defaults,
              ...spec.axis?.[key],
              title: expanded ? spec.axis?.[key]?.title : false,
            },
      ]),
    );
  }
  if (theme.base !== "classic" || theme.label === "ShowAI 靛蓝") {
    if (spec.style) {
      spec.style = { ...spec.style };
      for (const key of ["fill", "stroke", "labelFill", "labelStroke"]) {
        if (typeof spec.style[key] === "string")
          spec.style[key] = spec.style[key]
            .replace(/#1890ff|#5b8ff9/gi, theme.palette[0])
            .replace(/#7ec2f3/gi, theme.palette[2]);
        if (
          theme.base === "classicDark" &&
          ["#333", "#000", "#000000", "black"].includes(spec.style[key])
        )
          spec.style[key] = "#E6E8F0";
      }
    }
    if (
      spec.scale?.color?.type === "ordinal" ||
      Array.isArray(spec.scale?.color?.palette)
    ) {
      spec.scale = {
        ...spec.scale,
        color: {
          ...spec.scale.color,
          range: theme.palette,
          palette: undefined,
        },
      };
    }
  }
  if (spec.children)
    spec.children = spec.children.map((child) =>
      adaptSpec(child, theme, expanded, false),
    );
  return spec;
}

export function createContext(container, entry, themeName, expanded = false) {
  const charts = [];
  const renders = [];
  const theme = themes[themeName];
  class Chart extends BaseChart {
    constructor(options = {}) {
      const grid = container.closest(".grid");
      const width =
        container.clientWidth ||
        (grid
          ? parseFloat(
              getComputedStyle(grid).gridTemplateColumns.split(" ")[0],
            ) - 2
          : 700);
      super({
        ...options,
        container,
        autoFit: false,
        width,
        height: expanded ? 480 : 270,
        renderer: new SVGRenderer(),
        animate: false,
      });
      charts.push(this);
    }
    options(value) {
      if (arguments.length === 0) return super.options();
      const spec = adaptSpec(value, theme, expanded);
      if (spec.type === "sankey") {
        return super.options({
          type: "view",
          theme: spec.theme,
          legend: false,
          axis: false,
          paddingLeft: spec.paddingLeft,
          paddingRight: spec.paddingRight,
          paddingTop: spec.paddingTop,
          paddingBottom: spec.paddingBottom,
          children: [spec],
        });
      }
      return super.options(spec);
    }
    render() {
      const pending = super.render();
      renders.push(pending);
      return pending;
    }
  }
  return {
    Chart,
    container,
    asset,
    math: stableMath(entry.id),
    charts,
    textColor: theme.base === "classicDark" ? "#E6E8F0" : "#333",
    async flush() {
      await Promise.all(renders);
    },
    destroy() {
      charts.forEach((chart) => chart.destroy());
    },
  };
}
