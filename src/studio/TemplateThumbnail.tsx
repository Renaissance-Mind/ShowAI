import { useEffect, useRef, useState } from "react";
import { Loader2, ImageOff } from "../ui/icons";
import { SurfaceReader } from "../portable/SurfaceReader";
import { CustomComponentsProvider } from "../components/custom/CustomBlock";
import type { TemplateMetadata } from "../components/custom/types";
import type { LoadedTemplate } from "./CatalogDialogs";
import CatalogPreview from "./CatalogPreview";
import { desktop, errorMessage } from "./bridge";
const cache = new Map<string, Promise<LoadedTemplate>>();
let queue = Promise.resolve();
function readTemplate(item: TemplateMetadata, projectId?: string) {
  const args = {
    id: item.id,
    version: item.version,
    scope: item.scope,
    integrity: item.integrity,
    projectId,
  };
  const key = JSON.stringify(args);
  if (!cache.has(key)) {
    const request = queue.then(() =>
      desktop.invoke<LoadedTemplate>("templates:get", args),
    );
    queue = request.then(
      () => {},
      () => {},
    );
    cache.set(key, request);
    void request.catch(() => cache.delete(key));
  }
  return cache.get(key)!;
}
export default function TemplateThumbnail({
  item,
  projectId,
}: {
  item: TemplateMetadata;
  projectId?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false),
    [loaded, setLoaded] = useState<{ key: string; record: LoadedTemplate }>(),
    [error, setError] = useState("");
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "120px" },
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const key = `${item.scope}:${item.id}:${item.version}:${item.integrity}:${projectId ?? ""}`;
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setError("");
    void readTemplate(item, projectId).then(
      (value) => {
        if (!cancelled) setLoaded({ key, record: value });
      },
      (reason) => {
        if (!cancelled) setError(errorMessage(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [visible, key]);
  const record = loaded?.key === key ? loaded.record : undefined;
  return (
    <div className="template-card-preview" ref={host} aria-hidden="true" inert>
      {record ? (
        <CustomComponentsProvider components={record.components ?? []}>
          <CatalogPreview
            thumbnail
            label={`${item.name}缩略预览`}
            resetKey={key}
            width={960}
          >
            <SurfaceReader
              document={record.previewDocument ?? record.document}
              heading={null}
              partial
              presentation="spatial"
            />
          </CatalogPreview>
        </CustomComponentsProvider>
      ) : error ? (
        <span className="component-preview-error" title={error}>
          <ImageOff size={18} />
          预览暂不可用
        </span>
      ) : (
        <Loader2 size={18} className="studio-spin component-preview-loading" />
      )}
    </div>
  );
}
