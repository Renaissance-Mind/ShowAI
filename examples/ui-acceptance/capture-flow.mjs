import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const viewport = { width: 1200, height: 760 };
const width = 300;
const height = 236;
const transitionKinds = new Set(["forward", "back", "error"]);

export function layoutReviewFlow(
  { states, transitions },
  { graphlib, layout },
) {
  const ids = new Map(states.map(({ id }, index) => [id, "screen-" + index]));
  if (ids.size !== states.length || !ids.size)
    throw new Error("Flow canvas needs unique screen IDs.");
  if (!Array.isArray(transitions))
    throw new Error(
      "Declare reviewScenario.transitions to build a flow canvas.",
    );

  const graph = new graphlib.Graph({ multigraph: true, compound: true });
  graph.setGraph({
    rankdir: "LR",
    acyclicer: "greedy",
    ranksep: 144,
    nodesep: 54,
    edgesep: 28,
    marginx: 44,
    marginy: 44,
  });
  const groups = new Map();
  for (const state of states) {
    const key = ids.get(state.id);
    graph.setNode(key, { width, height });
    if (!state.group) continue;
    if (!groups.has(state.group)) {
      const group = "group-" + groups.size;
      groups.set(state.group, group);
      graph.setNode(group, {});
    }
    graph.setParent(key, groups.get(state.group));
  }

  const edges = transitions.map(
    ({ from, to, label, kind = "forward" }, index) => {
      if (!ids.has(from) || !ids.has(to))
        throw new Error("Unknown flow state in " + from + " → " + to);
      if (
        typeof label !== "string" ||
        !label.trim() ||
        !transitionKinds.has(kind)
      )
        throw new Error("Invalid flow transition " + from + " → " + to);
      const labelWidth = [...label].reduce(
        (sum, character) => sum + (/\p{Script=Han}/u.test(character) ? 14 : 8),
        16,
      );
      graph.setEdge(
        ids.get(from),
        ids.get(to),
        { width: labelWidth, height: 24, weight: kind === "back" ? 1 : 6 },
        String(index),
      );
      return { from, to, label, kind };
    },
  );
  layout(graph);
  const bounds = (key) => {
    const node = graph.node(key);
    return {
      x: node.x - node.width / 2,
      y: node.y - node.height / 2,
      width: node.width,
      height: node.height,
    };
  };
  return {
    width: graph.graph().width,
    height: graph.graph().height,
    nodes: states.map((state) => ({ ...state, ...bounds(ids.get(state.id)) })),
    groups: [...groups].map(([title, key]) => ({ title, ...bounds(key) })),
    edges: edges.map((edge, index) => ({
      ...edge,
      ...graph.edge(ids.get(edge.from), ids.get(edge.to), String(index)),
    })),
  };
}

export async function captureReviewFlow(
  html,
  { source = process.cwd(), lang } = {},
) {
  const require = createRequire(resolve(source, "package.json"));
  const { chromium } = require("playwright-core");
  const dagre = require("@dagrejs/dagre");
  const directory = await mkdtemp(join(tmpdir(), "showai-review-flow-"));
  let browser;
  try {
    const file = join(directory, "preview.html");
    await writeFile(file, html);
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.SHOWAI_BROWSER_EXECUTABLE,
    });
    async function withState(id, run) {
      const page = await browser.newPage({
        viewport,
        locale: lang || "en-US",
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
      });
      try {
        const url = pathToFileURL(file);
        url.searchParams.set("capture", "1");
        url.searchParams.set("marks", "0");
        if (id) url.hash = new URLSearchParams({ state: id }).toString();
        await page.goto(url.href);
        const panel = page.locator('.rv-inspector[aria-busy="false"]');
        await panel.waitFor({ state: "attached", timeout: 10000 });
        const error = page.locator(".rv-error:not([hidden])");
        if (await error.count()) throw new Error(await error.textContent());
        if (id && (await panel.getAttribute("data-state")) !== id)
          throw new Error("Could not capture review state " + id);
        return await run(page);
      } finally {
        await page.context().close();
      }
    }
    const manifest = await withState("", (page) =>
      page.locator(".rv-stage iframe").evaluate((frame) => {
        const { states, transitions } = frame.contentWindow.reviewScenario;
        return {
          states: states.map(({ id, title, group }) => ({ id, title, group })),
          transitions,
        };
      }),
    );
    const flow = layoutReviewFlow(manifest, dagre);
    for (const node of flow.nodes) {
      const image = await withState(node.id, (page) =>
        page.locator(".rv-stage iframe").screenshot({
          type: "jpeg",
          quality: 72,
          animations: "disabled",
          timeout: 10000,
        }),
      );
      node.image = "data:image/jpeg;base64," + image.toString("base64");
    }
    return flow;
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
