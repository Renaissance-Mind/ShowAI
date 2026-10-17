import { afterEach, expect, test } from "vitest";
import { createServer } from "node:http";
import { startModelGateway } from "./gateway";
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});
async function rejection(type: string, body: string) {
  const provider = createServer((_request, response) => {
    response.writeHead(403, { "content-type": type });
    response.end(body);
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  cleanup.push(() => {
    provider.closeAllConnections();
    provider.close();
  });
  const port = (provider.address() as { port: number }).port;
  const gateway = await startModelGateway(
    {
      id: "source",
      name: "Source",
      provider: "chatgpt",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: "model",
      protocol: "responses",
      credential: "chatgpt",
    },
    async () => "private-provider-credential",
  );
  cleanup.push(gateway.close);
  const response = await fetch(gateway.url + "/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${gateway.secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ input: [], model: "model" }),
  });
  return { status: response.status, body: await response.json() };
}
test("provider rejection keeps actionable code and redacts delegated credentials", async () => {
  const result = await rejection(
    "application/json",
    JSON.stringify({
      error: {
        code: "unsupported_country_region_territory",
        message:
          "Region unavailable; private-provider-credential; Bearer another-secret",
      },
    }),
  );
  expect(result.status).toBe(403);
  expect(result.body.error.code).toBe("unsupported_country_region_territory");
  expect(result.body.error.message).toContain("Region unavailable");
  expect(JSON.stringify(result.body)).not.toContain(
    "private-provider-credential",
  );
  expect(JSON.stringify(result.body)).not.toContain("another-secret");
});
test("HTML proxy errors and oversized JSON are not reflected to the Agent", async () => {
  const html = await rejection(
    "text/html",
    "<html>private proxy diagnostic</html>",
  );
  expect(html.status).toBe(403);
  expect(JSON.stringify(html.body)).not.toContain("private proxy");
  const oversized = await rejection(
    "application/json",
    JSON.stringify({ error: { message: "x".repeat(20000) } }),
  );
  expect(oversized.status).toBe(403);
  expect(JSON.stringify(oversized.body).length).toBeLessThan(300);
});
