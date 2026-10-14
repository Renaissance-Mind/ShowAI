import { useState } from "react";
import { Widget } from "../components/blocks/Widget";
import { downloadFile } from "../components/blocks/helpers";
import {
  componentAuthoringIndex,
  componentAuthoringGuide,
} from "../components/custom/authoring";
import type { ComponentSource } from "../components/custom/types";
import { componentAuthoringContent } from "./component-authoring-content";
import { errorMessage } from "./bridge";
import "./component-authoring-guides.css";

export default function ComponentAuthoringGuides({
  entry,
  loadSource,
}: {
  entry: string;
  loadSource?: () => Promise<ComponentSource>;
}) {
  const [source, setSource] = useState<ComponentSource>(),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  if (!source)
    return (
      <div className="component-authoring-guides">
        <p>查看原项目的制作流程、类型规范、输入示例和原版工具。</p>
        <button
          type="button"
          disabled={loading || !loadSource}
          onClick={() => {
            setLoading(true);
            setError("");
            loadSource!()
              .then((source) => {
                const index = componentAuthoringIndex(source.files, entry);
                setSelected(
                  index.guides.find((guide) =>
                    guide.sourcePath?.endsWith("SKILL.md"),
                  )?.id ?? index.guides[0].id,
                );
                setSource(source);
              })
              .catch((error) => setError(errorMessage(error)))
              .finally(() => setLoading(false));
          }}
        >
          {loading ? "正在读取指南…" : "打开原版制作指南"}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  const index = componentAuthoringIndex(source.files, entry),
    guide = componentAuthoringGuide(source.files, index, selected);
  return (
    <div className="component-authoring-guides">
      <label>
        制作指南
        <select
          aria-label="制作指南"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          {index.guides.map((guide) => (
            <option key={guide.id} value={guide.id}>
              {guide.title}
              {guide.appliesTo?.length
                ? ` · ${guide.appliesTo.join(", ")}`
                : ""}
            </option>
          ))}
        </select>
      </label>
      <p>
        {guide.url ? (
          <a href={guide.url} target="_blank" rel="noreferrer">
            原文与来源版本
          </a>
        ) : (
          "本地制作指南"
        )}{" "}
        · {index.commit?.slice(0, 8) ?? guide.sha256.slice(0, 8)}
      </p>
      <details>
        <summary>制作工具与输入规范</summary>
        <p>
          组件源码包内保留原版文件。按指南选择输入与类型，运行制作工具后导入生成的
          SVG 或 HTML。选择“原版”显示可核对完整布局。
        </p>
        <div className="component-authoring-downloads">
          {[
            index.kit,
            index.runner,
            "authoring/diagram-authoring-fonts.mjs",
            "authoring/font-licenses.json",
            index.schemas,
            index.examples,
          ]
            .filter((path): path is string => !!path && !!source.files[path])
            .map((path) => (
              <button
                key={path}
                type="button"
                onClick={() =>
                  downloadFile(
                    source.files[path],
                    path.split("/").pop()!,
                    path.endsWith(".json")
                      ? "application/json"
                      : "text/javascript",
                  )
                }
              >
                {path.split("/").pop()}
              </button>
            ))}
        </div>
      </details>
      <Widget
        kind="text"
        data={{
          content: componentAuthoringContent(guide.markdown, guide.url),
          format: "richtext",
        }}
        readOnly
      />
    </div>
  );
}
