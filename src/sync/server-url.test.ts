import { expect, test } from "vitest";
import {
  deepLinkInvitation,
  invitationBaseUrl,
  invitationUrl,
  serverBaseUrl,
  serverEndpoint,
} from "./server-url";

test("normalizes root and prefixed bases without losing deployment path", () => {
  expect(serverBaseUrl("https://example.com/")).toBe("https://example.com");
  expect(serverBaseUrl("https://example.com/cloud/")).toBe(
    "https://example.com/cloud",
  );
  expect(serverEndpoint("https://example.com/cloud/", "/api/info")).toBe(
    "https://example.com/cloud/api/info",
  );
  for (const input of [
    "https://a/cloud/../other",
    "https://a/%63loud",
    "https://a/cloud//",
    "https://a/cloud\\other",
    "https://a/cloud?x=1",
    "https://a/cloud?",
    "https://a/cloud#",
    "https://a/cloud#x",
    "https://user:password@a/cloud",
    "https://a/cloud/api",
    " https://a/cloud",
    "file:///cloud",
  ])
    expect(() => serverBaseUrl(input), input).toThrow();
});

test("invitation and desktop deep link preserve prefix and identity", () => {
  const link = invitationUrl(
    "https://example.com/cloud",
    "a".repeat(64),
    "server-1",
  );
  expect(invitationBaseUrl(link.href)).toBe("https://example.com/cloud");
  const deep = new URL("showai://join");
  deep.searchParams.set("server", "https://example.com/cloud");
  deep.searchParams.set("invite", "a".repeat(64));
  deep.searchParams.set("serverId", "server-1");
  expect(deepLinkInvitation(deep.href).href).toBe(link.href);
  expect(() =>
    invitationBaseUrl("https://example.com/cloud/../join#invite=x"),
  ).toThrow();
  expect(() =>
    invitationBaseUrl("https://example.com/cloud#invite=x"),
  ).toThrow();
});
