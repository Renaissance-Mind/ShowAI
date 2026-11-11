import type { ComponentSource } from "../components/custom/types";

/**
 * A custom component that declares a page-reference field and reads the
 * reference index through the SDK, the way an Agent would write one.
 */
export function relatedPagesComponent(
  id = "related-pages",
  version = "1.0.0",
): ComponentSource {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["title", "items"],
    properties: {
      title: { type: "string" },
      items: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "page", "note"],
          properties: {
            id: { type: "string" },
            page: { type: "string" },
            note: { type: "string" },
          },
        },
      },
    },
  };
  const data = { title: "Related pages", items: [] };
  return {
    files: {},
    manifest: {
      id,
      name: "Related pages",
      version,
      entry: "index.tsx",
      description: "Pages chosen by the author, followed by pages that link here.",
      scenarios: ["List hand-picked related pages and the pages linking here."],
      defaultData: data,
      examples: [{ name: "Empty list", data }],
      pageReferences: true,
      documentation: {
        version: 2,
        reuse: { kind: "general", boundaries: ["Lists of related pages."] },
        usage: {
          purpose: "Point readers to related pages.",
          structure: ["A title, the chosen pages and the pages linking here."],
          inputs: [
            { path: "title", meaning: "Heading of the list." },
            { path: "items", meaning: "Pages the author chose, in order." },
            { path: "items[].id", meaning: "Stable item id." },
            {
              path: "items[].page",
              meaning: "The related page as a showai:// page link.",
            },
            { path: "items[].note", meaning: "Why the page is related." },
          ],
          rules: [
            { kind: "unique", path: "items[].id" },
            { kind: "page", path: "items[].page" },
          ],
          recipes: [
            { title: "Empty list", steps: ["Add pages."], exampleIndex: 0 },
          ],
          interactions: [
            {
              action: "Open a page",
              effect: "goTo opens the page.",
              persistence: "none",
            },
          ],
          constraints: ["Pages are showai:// links."],
          editing: {
            data: ["Edit items through onChange."],
            implementation: ["Backlinks come from usePageReferences."],
          },
        },
        development: {
          entryPoints: [{ path: "index.tsx", purpose: "The list." }],
          architecture: ["Chosen pages from data, backlinks from the SDK."],
          extensionPoints: ["Group by kind."],
          invariants: ["Never invents page IDs."],
          verification: ["Link a page and see it listed."],
        },
      },
    },
    schema,
    source: `import React from 'react';import {usePageReferences} from 'showai:components';export default function Related({data,goTo}){const refs=usePageReferences({direction:'to'});return <section><h3>{data.title}</h3><ul>{data.items.map(i=><li key={i.id}><button type="button" onClick={()=>goTo(i.page)}>{i.note}</button></li>)}</ul><p data-status={refs.status}>{refs.items.map(r=>r.title).join(', ')}</p></section>}`,
  };
}

/** A component offered in the @ menu with fixed choices, placed inside a line. */
export function statusTagComponent(id = "status-tag"): ComponentSource {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["label"],
    properties: { label: { type: "string", maxLength: 40 } },
  };
  const data = { label: "todo" };
  return {
    files: {},
    manifest: {
      id,
      name: "Status tag",
      version: "1.0.0",
      entry: "index.tsx",
      description: "A short status inside a line of text.",
      scenarios: ["Mark a sentence as todo, blocked or done."],
      defaultData: data,
      examples: [{ name: "Todo", data }],
      contributes: {
        mention: {
          prop: "label",
          input: "options",
          options: [
            { label: "Todo", value: "todo" },
            { label: "Blocked", value: "blocked", keywords: "stuck" },
            { label: "Done", value: "done" },
          ],
        },
      },
      documentation: {
        version: 2,
        reuse: { kind: "general", boundaries: ["Short statuses in text."] },
        usage: {
          purpose: "Show a status inside a sentence.",
          structure: ["One label."],
          inputs: [{ path: "label", meaning: "The status shown." }],
          recipes: [{ title: "Todo", steps: ["Type @ and pick a status."], exampleIndex: 0 }],
          interactions: [
            { action: "Read", effect: "Shows the status.", persistence: "none" },
          ],
          constraints: ["At most 40 characters."],
          editing: {
            data: ["Change label."],
            implementation: ["Renders inline when inline is true."],
          },
        },
        development: {
          entryPoints: [{ path: "index.tsx", purpose: "The tag." }],
          architecture: ["One span."],
          extensionPoints: ["Colours per status."],
          invariants: ["Stays inside the line."],
          verification: ["Insert it with @ and read the line."],
        },
      },
    },
    schema,
    source: `import React from 'react';export default function Tag({data,inline}){return <span data-inline={inline?'yes':'no'} style={{padding:'0 4px',borderRadius:4,background:'#eee'}}>{data.label}</span>}`,
  };
}
