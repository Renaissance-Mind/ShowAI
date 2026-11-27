import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { compactData } from "./mcp-response";
import { AgentService, errorResult } from "./service";
import { createMcpServer } from "./mcp";
import { defaultPageOutline } from "../document/page-outline.mjs";

let home: string;
let projectId: string;
let smallPageId: string;
let smallSurfaceId: string;
let largePageId: string;
let client: Client;
let closePair: (() => Promise<void>) | undefined;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-mcp-response-"));
  const service = new AgentService({ root: home });
  const project = await service.createProject("Compaction & Outline");
  projectId = project.id;

  const small = await service.createPage(projectId, {
    title: "Small Page",
    blocks: [
      { kind: "text", data: { content: "## 第一节\n\n小页面正文。" } },
      { kind: "callout", data: { title: "结论", content: "要点说明。" } },
    ],
  });
  smallPageId = small.document.id;
  smallSurfaceId = String(small.document.content.attrs!.id);

  const bigChunk = "大页面章节正文内容用于超过默认读取阈值。".repeat(400);
  const large = await service.createPage(projectId, {
    title: "Large Page",
    blocks: Array.from({ length: 24 }, (_, i) => ({
      kind: "text",
      data: { content: `## 第 ${i + 1} 节\n\n${bigChunk}` },
    })),
  });
  largePageId = large.document.id;

  const server = createMcpServer({ root: home, projectId });
  client = new Client({ name: "mcp-response-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  closePair = async () => {
    await client.close();
    await server.close();
  };
}, 30000);

afterAll(async () => {
  await closePair?.();
  await rm(home, { recursive: true, force: true });
});

async function callMcp(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  return result.structuredContent as {
    ok: boolean;
    data?: Record<string, unknown>;
    error?: Record<string, unknown>;
  };
}

describe("MCP response compaction and root outline operations", () => {
  it("keeps JSON source reads free of duplicate outline and markdown", async () => {
    const response = await callMcp("page_read", {
      projectId,
      pageId: smallPageId,
      rendered: false,
      response: "source",
    });
    expect(response.ok).toBe(true);
    expect(response.data?.format).toBe("json");
    expect(response.data?.document).toBeTruthy();
    expect(response.data).not.toHaveProperty("outline");
    expect(response.data).not.toHaveProperty("markdown");
  });

  it("retains outline and paging scalars for explicit outline, paged outline, markdown and auto-outlined >256 KiB reads", async () => {
    const explicit = await callMcp("page_read", {
      projectId,
      pageId: smallPageId,
      rendered: false,
      detail: "outline",
      response: "source",
    });
    expect(explicit.ok).toBe(true);
    expect(explicit.data?.format).toBe("outline");
    expect(Array.isArray(explicit.data?.outline)).toBe(true);
    expect((explicit.data?.outline as unknown[]).length).toBeGreaterThan(0);
    expect(explicit.data).not.toHaveProperty("document");
    expect(explicit.data).not.toHaveProperty("blockCount");

    const topLevelBlocks = (items: unknown) =>
      (items as { depth: number }[]).filter((item) => item.depth === 1);

    const paged = await callMcp("page_read", {
      projectId,
      pageId: largePageId,
      rendered: false,
      detail: "outline",
      offset: 0,
      limit: 5,
      response: "source",
    });
    expect(paged.ok).toBe(true);
    expect(topLevelBlocks(paged.data?.outline)).toHaveLength(5);
    expect(paged.data?.blockCount).toBe(24);
    expect(paged.data?.offset).toBe(0);
    expect(paged.data?.nextOffset).toBe(5);

    const lastWindow = await callMcp("page_read", {
      projectId,
      pageId: largePageId,
      rendered: false,
      detail: "outline",
      offset: 20,
      limit: 10,
      response: "source",
    });
    expect(lastWindow.ok).toBe(true);
    expect(topLevelBlocks(lastWindow.data?.outline)).toHaveLength(4);
    expect(lastWindow.data?.blockCount).toBe(24);
    expect(lastWindow.data?.offset).toBe(20);
    expect(lastWindow.data).not.toHaveProperty("nextOffset");

    const autoLarge = await callMcp("page_read", {
      projectId,
      pageId: largePageId,
      rendered: false,
      response: "source",
    });
    expect(autoLarge.ok).toBe(true);
    expect(autoLarge.data?.format).toBe("outline");
    expect(Array.isArray(autoLarge.data?.outline)).toBe(true);
    expect(topLevelBlocks(autoLarge.data?.outline)).toHaveLength(24);
    expect(autoLarge.data?.blockCount).toBe(24);
    expect(autoLarge.data?.omitted).toMatchObject({
      reason: expect.stringContaining("256 KiB"),
    });

    const mdSource = await callMcp("page_read", {
      projectId,
      pageId: smallPageId,
      rendered: false,
      format: "markdown",
      response: "source",
    });
    expect(mdSource.ok).toBe(true);
    expect(mdSource.data?.format).toBe("markdown");
    expect(typeof mdSource.data?.markdown).toBe("string");
    expect(mdSource.data?.markdown).toContain("第一节");
    expect(Array.isArray(mdSource.data?.outline)).toBe(true);
    expect(mdSource.data).not.toHaveProperty("document");

    const receipt = compactData(autoLarge.data, "receipt") as Record<
      string,
      unknown
    >;
    expect(receipt.blockCount).toBe(24);
    expect(receipt.omitted).toMatchObject({
      reason: expect.stringContaining("256 KiB"),
    });
    expect(receipt).not.toHaveProperty("outline");
    expect(receipt).not.toHaveProperty("markdown");
  });

  it("applies root Page outline via block.attrs.set and distinguishes missing block vs missing page NOT_FOUND guidance", async () => {
    const initial = await callMcp("page_read", {
      projectId,
      pageId: smallPageId,
      rendered: false,
      response: "receipt",
    });
    const setByPageId = await callMcp("page_apply", {
      projectId,
      pageId: smallPageId,
      baseHash: initial.data!.hash,
      baseRevision: initial.data!.revision,
      operations: [
        {
          type: "block.attrs.set",
          blockId: smallPageId,
          attrs: { outline: defaultPageOutline() },
        },
      ],
    });
    expect(setByPageId.ok).toBe(true);
    expect(setByPageId.data?.changedBlocks).toMatchObject({ page: true });

    const clearBySurfaceId = await callMcp("page_apply", {
      projectId,
      pageId: smallPageId,
      baseHash: setByPageId.data!.hash,
      baseRevision: setByPageId.data!.revision,
      operations: [
        {
          type: "block.attrs.set",
          blockId: smallSurfaceId,
          attrs: { outline: null },
        },
      ],
    });
    expect(clearBySurfaceId.ok).toBe(true);

    const missingBlock = await callMcp("page_apply", {
      projectId,
      pageId: smallPageId,
      baseHash: clearBySurfaceId.data!.hash,
      baseRevision: clearBySurfaceId.data!.revision,
      operations: [
        {
          type: "block.text.set",
          blockId: "nonexistent-block-id",
          text: "nope",
        },
      ],
    });
    expect(missingBlock.ok).toBe(false);
    expect(missingBlock.error).toMatchObject({
      code: "NOT_FOUND",
      details: { missing: "block" },
      userMessage:
        "ShowAI could not find one of the items referenced in this change. Nothing was saved.",
    });
    expect(String(missingBlock.error?.nextStep)).toContain("page_read");

    const missingPage = await callMcp("page_read", {
      projectId,
      pageId: "nonexistent-page-id",
      rendered: false,
    });
    expect(missingPage.ok).toBe(false);
    expect(missingPage.error).toMatchObject({
      code: "NOT_FOUND",
      userMessage:
        "ShowAI could not find that project or page in the connected library.",
    });
    expect(String(missingPage.error?.nextStep)).toContain("pages_list");
    expect(errorResult).toBeTypeOf("function");
  });
});
