import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function packageSkillFormats() {
  const result = await build({
    stdin: {
      contents: 'import { getGuide, GUIDE_TOPICS } from "./src/agent/guides.ts"; export default Object.fromEntries(GUIDE_TOPICS.flatMap(topic => { const input = getGuide(topic).input; return input ? [[topic, input]] : []; }));',
      resolveDir: root,
      sourcefile: "skill-formats.ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const { default: formats } = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`
  );
  const directory = join(root, "plugins/showai/skills/use-showai/references/formats");
  await mkdir(directory, { recursive: true });
  for (const [name, input] of Object.entries(formats))
    await writeFile(join(directory, `${name}.json`), JSON.stringify(input, null, 2) + "\n");
}
