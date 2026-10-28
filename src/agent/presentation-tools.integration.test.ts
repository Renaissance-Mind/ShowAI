import { expect, test } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerPresentationTools } from "./presentation-tools";

// Thirteen positioned nodes in a chain, with a journey and stages: the shape
// that used to capture only the header above the graph.
const nodes = Array.from({ length: 13 }, (_, index) => ({
  id: `n${index}`,
  label: `Step ${index + 1}`,
  position: { x: (index % 4) * 220, y: Math.floor(index / 4) * 140 },
}));
const edges = nodes.slice(1).map((node, index) => ({
  id: `e${index}`,
  source: nodes[index].id,
  target: node.id,
}));
const flowchart = (height: number) => ({
  title: "Request route",
  height,
  flows: [
    {
      id: "main",
      label: "Main",
      nodes,
      edges,
      journeys: [
        {
          id: "request",
          label: "One request",
          steps: nodes.slice(0, 4).map((node) => ({
            node: node.id,
            title: node.label,
            text: `${node.label} handles the request.`,
          })),
        },
      ],
      stages: [
        { id: "normal", label: "Normal", nodes: { n0: { state: "ok" } } },
        { id: "failing", label: "Failing", nodes: { n6: { state: "bad" } } },
      ],
    },
  ],
});

async function showImage(height: number) {
  const server = new McpServer({ name: "showai-test", version: "1.0.0" });
  registerPresentationTools(server, { transport: "stdio" });
  const client = new Client({ name: "show-image-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({
      name: "show_component",
      arguments: {
        kind: "flowchart",
        data: flowchart(height),
        delivery: "image",
      },
    });
    expect(result.isError).not.toBe(true);
    const { delivery } = (
      result.structuredContent as {
        data: { delivery: { mode: string; width: number; height: number } };
      }
    ).data;
    expect(delivery.mode).toBe("image");
    const png = Buffer.from(
      (result.content as { type: string; data?: string }[]).find(
        (item) => item.type === "image",
      )!.data!,
      "base64",
    );
    expect(png.readUInt32BE(20)).toBe(delivery.height);
    return delivery;
  } finally {
    await client.close();
    await server.close();
  }
}

test("a show_component image grows with the flowchart height", async () => {
  const short = await showImage(360);
  const tall = await showImage(720);
  // The header and playback controls sit around the canvas.
  expect(short.height).toBeGreaterThan(360);
  expect(tall.height).toBeGreaterThan(720);
  expect(tall.height - short.height).toBe(360);
}, 60000);
