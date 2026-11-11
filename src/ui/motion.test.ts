import { describe, expect, test } from "vitest";
import tokens from "../design/tokens.css?raw";
import { exitKeyframes, parseDuration } from "./motion";

describe("motion values", () => {
  test("parses CSS times", () => {
    expect(parseDuration("140ms")).toBe(140);
    expect(parseDuration("0.2s")).toBe(200);
    expect(parseDuration(" 320ms ")).toBe(320);
    expect(parseDuration("")).toBe(0);
  });

  test("the token file defines the durations scripts read", () => {
    for (const token of [
      "--duration-fast",
      "--duration-base",
      "--duration-slow",
      "--ease-out",
      "--ease-in-out",
    ])
      expect(tokens).toContain(`${token}:`);
  });

  test("every exit ends transparent", () => {
    for (const style of ["fade", "pop", "drop", "rise"] as const) {
      const frames = exitKeyframes(style);
      expect(frames[0].opacity).toBe(1);
      expect(frames.at(-1)!.opacity).toBe(0);
    }
  });
});
