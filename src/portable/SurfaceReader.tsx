import { useMemo, type ReactNode } from "react";
import type { ShowDocument } from "../types";
import { upgradeResource } from "../surface/containers.mjs";
import { ContainerRuntime } from "../surface/ContainerRuntime";
import { PageContent } from "./PageContent";
export function SurfaceReader({
  document: input,
  heading,
  presentation = "spatial",
  partial = false,
}: {
  document: ShowDocument;
  heading: ReactNode;
  presentation?: "spatial" | "reading";
  partial?: boolean;
}) {
  const document = useMemo(
    () => upgradeResource(input, { includeTitle: !partial }),
    [input, partial],
  );
  return (
    <ContainerRuntime
      document={document}
      hideTitle={partial}
      header={heading}
      reading={presentation === "reading"}
      renderContent={({ content, componentData }) => (
        <PageContent content={content} data={componentData} />
      )}
    />
  );
}
