import type { JSONContent } from "@tiptap/core";
import type { ReactNode } from "react";
import PageSurface from "../surface/PageSurface";
import { placement, splitContent } from "../surface/model";
import { PageContent } from "./PageContent";

export function SurfaceReader({
  content,
  heading,
}: {
  content: JSONContent;
  heading: ReactNode;
}) {
  const { body, items } = splitContent(content);
  return (
    <PageSurface
      items={items.map((node) => ({
        id: node.attrs!.id,
        position: placement(node)!,
        content: (
          <PageContent content={{ type: "doc", content: node.content ?? [] }} />
        ),
      }))}
    >
      <main className="portable-document">
        {heading}
        <PageContent content={body} />
      </main>
    </PageSurface>
  );
}
