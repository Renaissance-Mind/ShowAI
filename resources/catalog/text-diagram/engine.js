import flow, { parseFlow } from "./vendor/components/flow.js";
import "./vendor/licenses.js";
import sequence, { parseSequence } from "./vendor/components/sequence.js";

const ui = {
  flow: "结构关系图",
  sequence: "时序图",
  colon: "：",
  sep: "、",
  delta: {
    added: "新增",
    removed: "移除",
    changed: "修改",
    view: "查看变更",
    before: "变更前",
    changes: "变更",
    after: "变更后",
  },
};
export function inspect(data) {
  if (!data || !["flow", "sequence"].includes(data.type))
    throw new Error("请选择结构关系图或时序图。");
  if (!["TB", "LR", "BT", "RL"].includes(data.direction ?? "TB"))
    throw new Error("排布方向无效。");
  if (
    typeof data.source !== "string" ||
    data.source.length > 12000 ||
    data.source.split("\n").length > 200
  )
    throw new Error("图形描述最多 12000 字、200 行。");
  if (!data.source.trim())
    return {
      type: data.type,
      nodes: [],
      edges: [],
      groups: [],
      warnings: [],
      empty: true,
    };
  if (data.type === "sequence") {
    const model = parseSequence(data.source);
    if (model.participants.length > 30 || model.steps.length > 150)
      throw new Error("时序图最多 30 个参与者、150 个步骤。");
    return {
      type: "sequence",
      participants: model.participants,
      steps: model.steps,
      derived: ["participants", "steps"],
    };
  }
  const model = parseFlow(data.source);
  if (
    model.nodes.size > 150 ||
    model.edges.length > 400 ||
    model.groups.length > 30
  )
    throw new Error("结构图最多 150 个节点、400 条连线、30 个分组。");
  const members = new Set();
  for (const group of model.groups)
    for (const name of group.members) {
      if (members.has(name))
        throw new Error(`节点「${name}」只能属于一个分组。`);
      members.add(name);
    }
  return {
    type: "flow",
    nodes: [...model.nodes.values()],
    edges: model.edges,
    groups: model.groups,
    warnings: model.warnings,
    derived: ["nodes", "edges", "groups"],
  };
}
export function renderDiagram(data, uid) {
  const model = inspect(data);
  if (model.empty) return { model, html: "" };
  const args =
    data.type === "flow"
      ? (data.direction ?? "TB")
      : data.numbered !== false
        ? "num"
        : "";
  const renderer = data.type === "flow" ? flow : sequence;
  const html = renderer.render(data.source, {
    args,
    uid: () => uid,
    ui,
    dir: "ltr",
  });
  return { model, html: html.replace(" am-view-changes", "") };
}
export const syntax = {
  flow: "A -> B: 连线说明\nA --> C: 虚线\nA -> B -> C\nA -> B & C\n(开始) -> {通过？}\n{通过？} -> *服务: 是\n服务 -> [(数据库)]\ngroup 后端: 服务, 数据库\n\n* 标记重点；+ / - / ~ 标记新增、移除和修改。\n节点名称即身份，带标点的名称放入方括号。",
  sequence:
    "participants: 客户端, 服务端\n客户端 -> 服务端: 请求\n服务端 --> 客户端: 响应\n服务端 -> 服务端: 内部处理\nnote 客户端, 服务端: 补充说明\n== 阶段名称 ==",
};
