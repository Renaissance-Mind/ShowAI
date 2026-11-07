import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";

/** Portable ZIP with UTF-8 names; packaged resources are small enough for ZIP32. */
function archive(entries: { name: string; data: Buffer }[]) {
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      data = deflateRawSync(entry.data);
    const checksum = crc32(entry.data),
      local = Buffer.alloc(30),
      record = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    central.push(record, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function chatgptAppId(value: string) {
  const text = value.trim();
  if (/^asdk_app_[A-Za-z0-9]+$/.test(text)) return text;
  if (/^plugin_asdk_app_[A-Za-z0-9]+$/.test(text)) return text.slice(7);
  const url = new URL(text);
  const match = url.pathname.match(
    /^\/plugins\/plugin_(asdk_app_[A-Za-z0-9]+)\/?$/,
  );
  if (
    url.protocol !== "https:" ||
    url.hostname !== "chatgpt.com" ||
    url.username ||
    url.password ||
    !match
  )
    throw new Error(
      "Use the ChatGPT page link of your registered custom MCP connection.",
    );
  return match[1];
}

/** Bundle only shared Skills and assets. No runtime, content, launcher or credentials. */
export async function remotePluginPackage(
  source: string,
  endpoint: string,
  connection: string,
) {
  const registeredApp = chatgptAppId(connection);
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/mcp"
  )
    throw new Error("A public HTTPS MCP endpoint is required.");
  const manifest = JSON.parse(
    await readFile(join(source, "plugin.json"), "utf8"),
  );
  const name = `showai-personal-${createHash("sha256").update(url.href).digest("hex").slice(0, 12)}`;
  manifest.name = name;
  manifest.description =
    "ShowAI workflows connected to your own desktop library.";
  manifest.extensions = {
    "com.openai": {
      apps: "./.app.json",
      onboardingSkill: "./skills/use-showai/SKILL.md",
      interface: {
        displayName: "ShowAI Personal",
        shortDescription: "Your ShowAI, from ChatGPT",
        longDescription:
          "Create, read and edit pages on your own ShowAI device. Connect once and approve the request in the desktop App.",
        category: "Productivity",
        defaultPrompt: ["Use ShowAI to create an interactive page."],
        brandColor: "#06A5FA",
        composerIcon: "./assets/logo.svg",
        composerIconDark: "./assets/logo-dark.svg",
        logo: "./assets/logo.svg",
        logoDark: "./assets/logo-dark.svg",
      },
    },
  };
  const files = new Map<string, Buffer>();
  const json = (value: unknown) =>
    Buffer.from(JSON.stringify(value, null, 2) + "\n");
  files.set("plugin.json", json(manifest));
  files.set(".app.json", json({ apps: { showai: { id: registeredApp } } }));
  async function visit(path: string) {
    for (const entry of (
      await readdir(join(source, path), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${path}/${entry.name}`;
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) await visit(relative);
      else if (entry.isFile())
        files.set(relative, await readFile(join(source, relative)));
      else throw new Error(`Unsupported plugin resource: ${relative}`);
    }
  }
  await visit("skills");
  for (const file of ["logo.svg", "logo-dark.svg"])
    files.set(`assets/${file}`, await readFile(join(source, "assets", file)));
  files.set(
    "skills/use-showai/references/host-adapter.md",
    await readFile(join(source, "host-adapters/mcp-app.md")),
  );
  const skills = [...files.keys()].filter((path) =>
    /^skills\/[^/]+\/SKILL.md$/.test(path),
  );
  if (skills.length !== 6)
    throw new Error("The complete ShowAI workflow bundle is missing.");
  return {
    name,
    version: manifest.version as string,
    endpoint: url.href,
    files: [...files.keys()],
    bytes: archive(
      [...files].map(([path, data]) => ({ name: `${name}/${path}`, data })),
    ),
  };
}
