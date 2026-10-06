import { ObjectContext } from "../surface/SurfaceObject";
import { useMemo, type ReactNode } from "react";
import type { ShowDocument } from "../types";
import PageSurface from "../surface/PageSurface";
import {
  nodePaths,
  upgradeDocument,
  orderedSurfaceNodes,
} from "../surface/document.mjs";
import { SurfaceContent, nodeName } from "../surface/SurfaceContent";
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
    () => upgradeDocument(input, { includeTitle: !partial }),
    [input, partial],
  );
  if (presentation === "reading")
    return (
      <ObjectContext.Provider
        value={{
          scale: 1,
          selected: null,
          select: () => {},
          readOnly: true,
          revealAll: true,
          revealed: new Set(),
        }}
      >
        <main className="portable-document surface-reading">
          <div className="surface-reading-heading">{heading}</div>
          <SurfaceContent
            document={document}
            spatial={false}
            renderContent={({ content }) => <PageContent content={content} />}
          />
        </main>
      </ObjectContext.Provider>
    );
  return (
    <PageSurface
      pageId={document.id}
      nodes={orderedSurfaceNodes(document).map((node) => ({
        id: node.attrs!.id,
        name: nodeName(node),
      }))}
      layoutKey={JSON.stringify(document.layout)}
      paths={nodePaths(document)}
      views={document.views!}
      header={heading}
    >
      <SurfaceContent
        document={document}
        renderContent={({ content }) => <PageContent content={content} />}
      />
    </PageSurface>
  );
}
