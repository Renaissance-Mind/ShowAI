import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// The workbench is split so parallel work lands in different files; these
// limits keep Studio.tsx a composition and every part small enough to own.
const STUDIO_LIMIT = 1500;
const SHELL_LIMIT = 1200;

const shell = dirname(fileURLToPath(import.meta.url));
const lines = (file: string) => readFileSync(file, "utf8").split("\n").length;
const sources = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(directory, entry.name))
      : /\.tsx?$/.test(entry.name)
        ? [join(directory, entry.name)]
        : [],
  );

describe("workbench shell size", () => {
  test(`Studio.tsx stays within ${STUDIO_LIMIT} lines`, () => {
    expect(lines(join(shell, "..", "Studio.tsx"))).toBeLessThanOrEqual(
      STUDIO_LIMIT,
    );
  });

  test(`each shell file stays within ${SHELL_LIMIT} lines`, () => {
    const oversized = sources(shell)
      .map((file) => ({ file: relative(shell, file), lines: lines(file) }))
      .filter((item) => item.lines > SHELL_LIMIT);
    expect(oversized).toEqual([]);
  });
});
