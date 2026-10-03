import { Component, useSyncExternalStore, type ReactNode } from "react";
import { FileJson, Puzzle } from "lucide-react";
import {
  getBlockDefinition,
  getRegistryRevision,
  subscribeToBlocks,
} from "./registry";
import { downloadFile } from "./helpers";
import type { BlockProps } from "./types";
import "./block.css";

function UnavailableBlock({
  kind,
  data,
  error,
}: BlockProps & { kind: string; error?: string }) {
  return (
    <section className="sb-block sb-unavailable" aria-label="区块暂时无法显示">
      <div className="sb-unavailable-heading">
        <Puzzle size={20} />
        <div>
          <strong>
            {error ? "区块数据需要检查" : `尚未注册「${kind}」区块`}
          </strong>
          <p>{error || "原始数据已保留。注册对应的 React 组件后即可显示。"}</p>
        </div>
      </div>
      <details className="sb-data-details">
        <summary>查看区块数据</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
      <button
        type="button"
        className="sb-button"
        onClick={() =>
          downloadFile(
            JSON.stringify({ kind, data }, null, 2),
            `${kind}.json`,
            "application/json",
          )
        }
      >
        <FileJson size={14} />
        下载区块数据
      </button>
    </section>
  );
}

class BlockBoundary extends Component<
  { children: ReactNode; kind: string; data: BlockProps["data"] },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message || "组件渲染失败。" };
  }
  componentDidUpdate(previous: { data: BlockProps["data"]; kind: string }) {
    if (
      this.state.error &&
      (previous.data !== this.props.data || previous.kind !== this.props.kind)
    )
      this.setState({ error: null });
  }
  render() {
    return this.state.error ? (
      <UnavailableBlock
        kind={this.props.kind}
        data={this.props.data}
        error={this.state.error}
      />
    ) : (
      this.props.children
    );
  }
}

export function Widget({
  kind,
  data,
  onChange,
  readOnly,
}: BlockProps & { kind: string }) {
  useSyncExternalStore(
    subscribeToBlocks,
    getRegistryRevision,
    getRegistryRevision,
  );
  const definition = getBlockDefinition(kind);
  if (!definition) return <UnavailableBlock kind={kind} data={data} />;
  if (definition.validate) {
    try {
      definition.validate(data);
    } catch (error) {
      return (
        <UnavailableBlock
          kind={kind}
          data={data}
          error={
            error instanceof Error ? error.message : "区块数据格式不正确。"
          }
        />
      );
    }
  }
  const Renderer = definition.renderer;
  return (
    <BlockBoundary key={kind} kind={kind} data={data}>
      <Renderer
        data={data}
        onChange={readOnly ? undefined : onChange}
        readOnly={readOnly}
      />
    </BlockBoundary>
  );
}
