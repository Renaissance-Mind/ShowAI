import { useState } from "react";
import { FileText, Music2, Video } from "../../ui/icons";
import { safeImageUrl, text } from "./helpers";
import { safeResourceUrl } from "./research-contract.mjs";
import { BlockHeader, EmptyState } from "./shared";
import { ResourceEditor } from "./ResourceEditor";
import type { BlockProps } from "./types";
import "./research-media.css";

function MediaBlock({
  kind,
  data,
  onChange,
  readOnly,
}: BlockProps & { kind: "video" | "audio" }) {
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState("");
  const editable = Boolean(onChange && !readOnly);
  const src = safeResourceUrl(kind, data.src);
  const label = kind === "video" ? "视频" : "音频";
  const Icon = kind === "video" ? Video : Music2;
  return (
    <section
      className={`sb-block sb-media sb-${kind}`}
      aria-label={text(data.title) || label}
    >
      {(kind === "audio" || !src) && (
        <BlockHeader
          editable={editable}
          editing={editing}
          onEdit={() => setEditing(!editing)}
        />
      )}
      {editing && (
        <ResourceEditor
          kind={kind}
          data={data}
          onClose={() => setEditing(false)}
          onSave={(next) => {
            onChange?.(next);
            setEditing(false);
            setFailed("");
          }}
        />
      )}
      {src ? (
        <figure className="sb-media-figure">
          {kind === "video" ? (
            <div className="sb-video-stage" data-surface-gesture="own">
              <BlockHeader
                title={text(data.title)}
                defaultTitle={label}
                editable={editable}
                editing={editing}
                onEdit={() => setEditing(!editing)}
              />
              <video
                key={src}
                controls
                playsInline
                preload="metadata"
                poster={safeImageUrl(data.poster)}
                loop={data.loop === true}
                muted={data.muted === true}
                style={{
                  aspectRatio: text(data.aspectRatio, "16:9").replace(
                    ":",
                    " / ",
                  ),
                }}
                src={src}
                aria-label={text(data.title) || "视频播放器"}
                onError={() => setFailed(src)}
              />
            </div>
          ) : (
            <div className="sb-audio-body" data-surface-gesture="own">
              <div className="sb-audio-icon">
                <Music2 size={20} />
              </div>
              <div className="sb-audio-track">
                <div className="sb-audio-name">
                  {text(data.title) || text(data.fileName) || "音频"}
                </div>
                <audio
                  key={src}
                  controls
                  preload="metadata"
                  src={src}
                  loop={data.loop === true}
                  aria-label={text(data.title) || "音频播放器"}
                  onError={() => setFailed(src)}
                />
              </div>
            </div>
          )}
          {failed === src && (
            <p className="sb-error" role="alert">
              文件无法播放，请检查地址、网络或文件编码。
              <a
                href={src}
                download={text(data.fileName) || undefined}
                target="_blank"
                rel="noopener noreferrer"
              >
                打开原文件
              </a>
            </p>
          )}
          {text(data.caption) && (
            <figcaption className="sb-resource-caption">
              {text(data.caption)}
            </figcaption>
          )}
        </figure>
      ) : (
        <EmptyState
          icon={<Icon size={28} strokeWidth={1.4} />}
          title={`添加${label}`}
          description="上传本地文件或填写在线文件地址"
          action={
            editable && !editing ? (
              <button
                type="button"
                className="sb-button"
                onClick={() => setEditing(true)}
              >
                <FileText size={14} />
                选择文件
              </button>
            ) : undefined
          }
        />
      )}
    </section>
  );
}
export const VideoBlock = (props: BlockProps) => (
  <MediaBlock {...props} kind="video" />
);
export const AudioBlock = (props: BlockProps) => (
  <MediaBlock {...props} kind="audio" />
);
