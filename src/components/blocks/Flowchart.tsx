import { useEffect, useMemo, useState, useId, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  MarkerType,
  useReactFlow,
  useNodesState,
  useNodes,
  useNodesInitialized,
  useStore,
  type Node,
  type NodeProps,
  type Edge,
} from "@xyflow/react";
import { graphlib, layout } from "@dagrejs/dagre";
import { Maximize2, Minus, Plus, X } from "../../ui/icons";
import type { BlockProps, BlockData } from "./types";
import { BlockHeader, EmptyState } from "./shared";
import { useViewportLock, ViewportLockButton } from "./ViewportLock";
import { validateFlowchartData } from "./flowchart-contract.mjs";
import "@xyflow/react/dist/style.css";
import "./flowchart.css";

type Kind = "request" | "skill" | "decision" | "reference" | "query" | "result";
interface FlowNode extends Record<string, unknown> {
  id: string;
  label: string;
  subtitle?: string;
  kind?: Kind;
  detail?: string;
  commands?: string[];
  references?: string[];
  position?: { x: number; y: number };
  sourceSide?: "top" | "bottom" | "left" | "right";
  targetSide?: "top" | "bottom" | "left" | "right";
}
interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}
interface Flow {
  id: string;
  label: string;
  description?: string;
  direction?: "TB" | "LR";
  nodes: FlowNode[];
  edges: FlowEdge[];
}
interface FlowData extends BlockData {
  title?: string;
  description?: string;
  height?: number;
  flows: Flow[];
}
type DiagramNode = Node<FlowNode & { direction: "TB" | "LR" }, "showai">;
const kinds: Record<Kind, string> = {
  request: "用户意图",
  skill: "技能入口",
  decision: "条件判断",
  reference: "按需文档",
  query: "CLI 查询",
  result: "结果",
};
function DiagramCard({ data, selected }: NodeProps<DiagramNode>) {
  const horizontal = data.direction === "LR";
  return (
    <div
      className={`sf-node sf-${data.kind ?? "query"}${selected ? " is-selected" : ""}`}
    >
      <Handle
        type="target"
        position={
          data.targetSide
            ? (data.targetSide as Position)
            : horizontal
              ? Position.Left
              : Position.Top
        }
      />
      {data.kind && <span className="sf-node-kind">{kinds[data.kind]}</span>}
      <strong>{data.label}</strong>
      {data.subtitle && (
        <span className="sf-node-subtitle">{data.subtitle}</span>
      )}
      <Handle
        type="source"
        position={
          data.sourceSide
            ? (data.sourceSide as Position)
            : horizontal
              ? Position.Right
              : Position.Bottom
        }
      />
    </div>
  );
}
const nodeTypes = { showai: DiagramCard };

function FitFlowViewport({ locked }: { locked: boolean }) {
  const { fitView, viewportInitialized } = useReactFlow();
  const initialized = useNodesInitialized();
  const nodes = useNodes();
  const domNode = useStore((state) => state.domNode);
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const previous = useRef<{
    width: number;
    height: number;
    geometry: string;
  } | null>(null);
  const geometry = JSON.stringify(
    nodes.map((node) => [
      node.id,
      node.position.x,
      node.position.y,
      node.measured?.width,
      node.measured?.height,
    ]),
  );

  useEffect(() => {
    if (!domNode) return;
    const measure = () => {
      const next = { width: domNode.offsetWidth, height: domNode.offsetHeight };
      setSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(domNode);
    measure();
    return () => observer.disconnect();
  }, [domNode]);

  useEffect(() => {
    // Hidden tabs have no usable dimensions. React Flow may keep its previous
    // store size, so wait for both the real element and measured nodes.
    if (
      !domNode ||
      !viewportInitialized ||
      !initialized ||
      !size.width ||
      !size.height ||
      width !== size.width ||
      height !== size.height
    )
      return;
    const next = { ...size, geometry },
      last = previous.current;
    if (
      last &&
      (!locked ||
        (last.width === next.width &&
          last.height === next.height &&
          last.geometry === geometry))
    ) {
      previous.current = next;
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (
        domNode.offsetWidth !== size.width ||
        domNode.offsetHeight !== size.height
      )
        return;
      previous.current = next;
      void fitView({ padding: 0.08 });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    domNode,
    fitView,
    viewportInitialized,
    initialized,
    size,
    width,
    height,
    geometry,
    locked,
  ]);
  return null;
}

function NodeEditor({
  node,
  onSave,
}: {
  node: FlowNode;
  onSave: (patch: Partial<FlowNode>) => void;
}) {
  const [label, setLabel] = useState(node.label);
  const [detail, setDetail] = useState(node.detail ?? "");
  useEffect(() => {
    setLabel(node.label);
    setDetail(node.detail ?? "");
  }, [node.id, node.label, node.detail]);
  return (
    <details className="sf-editor">
      <summary>编辑所选节点</summary>
      <label>
        名称
        <input
          value={label}
          aria-invalid={!label.trim()}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <label>
        说明
        <textarea
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
        />
      </label>
      {!label.trim() && <p role="alert">节点名称需要有内容。</p>}
      <button
        type="button"
        disabled={!label.trim()}
        onClick={() => onSave({ label: label.trim(), detail })}
      >
        保存节点
      </button>
    </details>
  );
}
export function layoutFlow(flow: Flow): DiagramNode[] {
  const graph = new graphlib.Graph();
  const direction = flow.direction ?? "TB";
  graph.setGraph({
    rankdir: direction,
    nodesep: 38,
    ranksep: 62,
    marginx: 24,
    marginy: 24,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  flow.nodes.forEach((node) =>
    graph.setNode(node.id, { width: 218, height: 106 }),
  );
  flow.edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  layout(graph);
  return flow.nodes.map((node) => {
    const point = graph.node(node.id);
    return {
      id: node.id,
      type: "showai",
      data: { ...node, direction },
      position: node.position ?? { x: point.x - 109, y: point.y - 53 },
    };
  });
}
function FlowControls({ locked }: { locked: boolean }) {
  const graph = useReactFlow();
  return (
    <div className="sf-controls" aria-label="流程图视图">
      <button
        type="button"
        onClick={() => graph.zoomIn()}
        disabled={locked}
        aria-label="放大流程图"
      >
        <Plus size={16} />
      </button>
      <button
        type="button"
        onClick={() => graph.zoomOut()}
        disabled={locked}
        aria-label="缩小流程图"
      >
        <Minus size={16} />
      </button>
      <button
        type="button"
        onClick={() => graph.fitView({ padding: 0.08, duration: 200 })}
        disabled={locked}
        aria-label="显示完整流程"
      >
        <Maximize2 size={16} />
      </button>
    </div>
  );
}
function FlowCanvas({
  flow,
  height,
  readOnly,
  locked,
  onPosition,
  selected,
  onSelect,
}: {
  flow: Flow;
  height: number;
  readOnly: boolean;
  locked: boolean;
  onPosition: (id: string, position: { x: number; y: number }) => void;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const layoutNodes = useMemo(() => layoutFlow(flow), [flow]);
  const initialNodes = useMemo(
    () =>
      layoutNodes.map((node) => ({
        ...node,
        selected: node.id === selected,
      })),
    [layoutNodes, selected],
  );
  const [nodes, setNodes, onNodesChange] =
    useNodesState<DiagramNode>(initialNodes);
  useEffect(() => setNodes(initialNodes), [initialNodes, setNodes]);
  const edges: Edge[] = useMemo(
    () =>
      flow.edges.map((edge) => ({
        ...edge,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: 1.5 },
        labelStyle: { fontSize: 13 },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
      })),
    [flow],
  );
  return (
    <div
      className="sf-canvas"
      style={{ height }}
      role="group"
      aria-label={flow.label}
    >
      <ReactFlow
        proOptions={{ hideAttribution: true }}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        minZoom={0.25}
        maxZoom={2}
        nodesDraggable={!readOnly && !locked}
        panOnDrag={!locked}
        zoomOnScroll={!locked}
        zoomOnPinch={!locked}
        zoomOnDoubleClick={!locked}
        preventScrolling={!locked}
        autoPanOnNodeFocus={!locked}
        autoPanOnNodeDrag={!locked}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        onNodeClick={(_, node) => onSelect(node.id)}
        onNodeDragStop={(_, node) => onPosition(node.id, node.position)}
      >
        <FitFlowViewport locked={locked} />
        <FlowControls locked={locked} />
      </ReactFlow>
      <details className="sf-node-picker">
        <summary aria-label="节点列表">节点</summary>
        <div>
          {flow.nodes.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={selected === item.id}
              onClick={() => onSelect(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
export function FlowchartBlock({
  data: raw,
  onChange,
  readOnly = false,
}: BlockProps) {
  const instanceId = useId();
  const lock = useViewportLock("flowchart");
  const data = validateFlowchartData(raw) as FlowData;
  const [flowId, setFlowId] = useState(data.flows[0]?.id ?? "");
  const flow = data.flows.find((item) => item.id === flowId) ?? data.flows[0];
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (flow && !flow.nodes.some((node) => node.id === selected))
      setSelected("");
  }, [flow, selected]);
  const node = flow?.nodes.find((item) => item.id === selected);
  const changeNode = (id: string, patch: Partial<FlowNode>) =>
    onChange?.({
      ...data,
      flows: data.flows.map((item) =>
        item.id === flow.id
          ? {
              ...item,
              nodes: item.nodes.map((node) =>
                node.id === id ? { ...node, ...patch } : node,
              ),
            }
          : item,
      ),
    });
  return (
    <section
      ref={lock.ref}
      className="sb-block sf-block"
      aria-label={data.title || "流程图"}
      data-viewport-lock-scope="flowchart"
      data-viewport-locked={lock.locked}
    >
      <BlockHeader
        title={data.title}
        defaultTitle="交互流程图"
        description={data.description}
      />
      <ViewportLockButton {...lock} label="流程图" />
      {!flow ? (
        <EmptyState title="添加一条流程" />
      ) : (
        <>
          {data.flows.length > 1 && (
            <div className="sf-tabs" role="tablist" aria-label="选择流程">
              {data.flows.map((item) => (
                <button
                  key={item.id}
                  id={`${instanceId}-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={item.id === flow.id}
                  aria-controls={`${instanceId}-panel-${item.id}`}
                  onClick={() => {
                    setFlowId(item.id);
                    setSelected("");
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
          <div
            role="tabpanel"
            id={`${instanceId}-panel-${flow.id}`}
            aria-labelledby={
              data.flows.length > 1 ? `${instanceId}-tab-${flow.id}` : undefined
            }
          >
            {flow.description && (
              <p className="sf-description">{flow.description}</p>
            )}
            <ReactFlowProvider key={flow.id}>
              <FlowCanvas
                flow={flow}
                height={data.height ?? 580}
                readOnly={readOnly}
                locked={lock.locked}
                selected={selected}
                onSelect={setSelected}
                onPosition={(id, position) => {
                  if (!readOnly) changeNode(id, { position });
                }}
              />
            </ReactFlowProvider>
            {node &&
              (node.detail ||
                node.commands?.length ||
                node.references?.length ||
                (!readOnly && onChange)) && (
                <div className="sf-detail" aria-live="polite">
                  <div className="sf-detail-heading">
                    {node.kind && <span>{kinds[node.kind]}</span>}
                    <strong>{node.label}</strong>
                    <button
                      type="button"
                      className="sb-icon-button"
                      aria-label="关闭节点详情"
                      onClick={() => setSelected("")}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {node.detail && <p>{node.detail}</p>}
                  {!!node.commands?.length && (
                    <div className="sf-detail-group">
                      <span>按需查询</span>
                      {node.commands.map((command) => (
                        <code key={command}>{command}</code>
                      ))}
                    </div>
                  )}
                  {!!node.references?.length && (
                    <div className="sf-detail-group">
                      <span>此时读取</span>
                      {node.references.map((reference) => (
                        <code key={reference}>{reference}</code>
                      ))}
                    </div>
                  )}
                  {!readOnly && onChange && (
                    <NodeEditor
                      node={node}
                      onSave={(patch) => changeNode(node.id, patch)}
                    />
                  )}
                </div>
              )}
          </div>
        </>
      )}
    </section>
  );
}
