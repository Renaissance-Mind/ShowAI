import { createHash } from "node:crypto";

const safeFontUrl = (value, host) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== host)
    throw new Error(`Unsupported font origin: ${url.origin}`);
  return url;
};
function faceUsesCharacters(face, characters) {
  const declaration = face.match(/unicode-range\s*:\s*([^;}]*)/i)?.[1];
  if (!declaration) return true;
  const ranges = declaration.split(",").map((value) => {
    const match = value.trim().match(/^U\+([A-F\d?]+)(?:-([A-F\d]+))?$/i);
    if (!match) throw new Error(`Unsupported font unicode range: ${value}`);
    return [
      parseInt(match[1].replaceAll("?", "0"), 16),
      parseInt(match[2] ?? match[1].replaceAll("?", "F"), 16),
    ];
  });
  return [...characters].some((point) =>
    ranges.some(([a, b]) => point >= a && point <= b),
  );
}
export async function offlineDiagramFonts(html, licenses = {}) {
  const links = [
    ...html.matchAll(
      /<link\b[^>]*href=["'](https:\/\/fonts\.googleapis\.com\/[^"']+)["'][^>]*>/gi,
    ),
  ];
  if (!links.length) return { source: html, css: "", fonts: [] };
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) =>
      String.fromCodePoint(
        parseInt(
          code.toLowerCase().startsWith("x") ? code.slice(1) : code,
          code.toLowerCase().startsWith("x") ? 16 : 10,
        ),
      ),
    );
  // The content stays local. Google receives font family names, never a text= query.
  const characters = new Set([...text].map((value) => value.codePointAt(0)));
  const assets = new Map();
  const faces = [];
  const requests = [
    ...new Set(links.map((match) => match[1].replaceAll("&amp;", "&"))),
  ];
  for (const request of requests) {
    const url = safeFontUrl(request, "fonts.googleapis.com");
    if (
      !["/css", "/css2"].includes(url.pathname) ||
      [...url.searchParams.keys()].some(
        (key) => !["family", "display"].includes(key),
      )
    )
      throw new Error(
        "Text-subset font requests are not used; authoring content stays local.",
      );
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok)
      throw new Error(`Font stylesheet failed (${response.status}): ${url}`);
    const css = await response.text();
    for (const match of css.matchAll(/@font-face\s*\{[^}]*\}/gi)) {
      if (!faceUsesCharacters(match[0], characters)) continue;
      let face = match[0];
      for (const item of face.matchAll(
        /url\((?:["']?)(https:\/\/fonts\.gstatic\.com\/[^)"']+)(?:["']?)\)/gi,
      )) {
        const fontUrl = safeFontUrl(item[1], "fonts.gstatic.com").href;
        if (!assets.has(fontUrl)) {
          const fontResponse = await fetch(fontUrl, {
            signal: AbortSignal.timeout(45000),
          });
          if (!fontResponse.ok)
            throw new Error(
              `Font download failed (${fontResponse.status}): ${fontUrl}`,
            );
          const bytes = Buffer.from(await fontResponse.arrayBuffer());
          assets.set(fontUrl, {
            url: fontUrl,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            bytes: bytes.length,
            data: `data:font/woff2;base64,${bytes.toString("base64")}`,
          });
        }
        face = face.replace(
          item[0],
          () => `url("${assets.get(fontUrl).data}")`,
        );
      }
      faces.push(face);
    }
  }
  const css = [...new Set(faces)].join("\n");
  const notice = Object.entries(licenses)
    .map(([family, license]) => `${family}\n${license}`)
    .join("\n\n")
    .replaceAll("--", "—");
  let source = html;
  for (const [i, match] of links.entries())
    source = source.replace(match[0], () =>
      i === 0
        ? `<!-- Offline font licenses\n${notice}\n--><style>${css}</style>`
        : "",
    );
  return {
    source,
    css,
    fonts: [...assets.values()].map(({ data, ...metadata }) => metadata),
  };
}
