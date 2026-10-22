import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

let directory: string;
let executable: string;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "showai-ink-binary-transport-"));
  executable = join(directory, process.platform === "win32" ? "echo.exe" : "echo");
  execFileSync(process.env.SHOWAI_INK_NATIVE_CLANG ?? "clang++", [
    "-std=c++17",
    "-O2",
    "src/surface/ink-kernel/binary-stdio-contract.cpp",
    "-o",
    executable,
  ]);
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

it("preserves every binary byte, including CR/LF and Ctrl-Z, through the actual native parity streams", () => {
  const input = Buffer.alloc(65539);
  for (let i = 0; i < input.length; i++) input[i] = i % 256;
  const output = execFileSync(executable, [], { input });
  expect(output).toEqual(input);
});
