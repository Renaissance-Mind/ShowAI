import { expect, test } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { base64url } from "./account-crypto";
import { googleIdentity, providerJson } from "./external-logins";

test("provider requests accept JSON but never forward credentials across redirects", async () => {
  let forwarded = 0;
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(307, { location: "/receiver" }).end();
    } else {
      if (request.url === "/receiver") forwarded++;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ received: true }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing listener");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    expect(await providerJson(origin + "/json")).toEqual({ received: true });
    await expect(
      providerJson(origin + "/redirect", {
        method: "POST",
        body: new URLSearchParams({ client_secret: "redirect-guard-fixture" }),
      }),
    ).rejects.toMatchObject({ code: "LOGIN_PROVIDER_FAILED" });
    expect(forwarded).toBe(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("Google identity verification checks signature, audience, nonce, issuer, expiry and verified email", async () => {
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = {
    ...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
    kid: "identity-test-key",
  };
  const original = {
    iss: "https://accounts.google.com",
    aud: "showai-test-client",
    sub: "12345",
    nonce: "verified-nonce",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
    email_verified: true,
    email: "identity@example.com",
    name: "Verified identity",
  };
  async function jwt(claims: Record<string, unknown>) {
    const encoder = new TextEncoder(),
      header = base64url(
        encoder.encode(JSON.stringify({ alg: "RS256", kid: jwk.kid })),
      ),
      payload = base64url(encoder.encode(JSON.stringify(claims)));
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keys.privateKey,
      encoder.encode(header + "." + payload),
    );
    return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
  }
  const valid = await jwt(original);
  expect(
    await googleIdentity(valid, original.aud, original.nonce, [jwk]),
  ).toMatchObject({ subject: "12345", email: "identity@example.com" });
  for (const override of [
    { iss: "https://other.example.com" },
    { aud: "another-client" },
    { nonce: "another-nonce" },
    { exp: 1 },
    { email_verified: false },
    { aud: [original.aud, "another"], azp: "another" },
  ])
    await expect(
      googleIdentity(
        await jwt({ ...original, ...override }),
        original.aud,
        original.nonce,
        [jwk],
      ),
    ).rejects.toMatchObject({ code: "INVALID_ID_TOKEN" });
  const parts = valid.split(".");
  const damaged = parts[2].split("");
  damaged[0] = damaged[0] === "A" ? "B" : "A";
  await expect(
    googleIdentity(
      `${parts[0]}.${parts[1]}.${damaged.join("")}`,
      original.aud,
      original.nonce,
      [jwk],
    ),
  ).rejects.toMatchObject({ code: "INVALID_ID_TOKEN" });
});
