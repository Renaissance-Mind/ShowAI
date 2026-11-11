import { strToU8, zipSync } from "fflate";

// Small hand-made inputs for the importer tests: a Notion "Markdown & CSV"
// export (as Notion names and links its files) and a Word document built
// from its XML parts. No personal data.

export const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
/** A one-page PDF with a correct cross-reference table. */
function pdf(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const at = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .map((at) => `${String(at).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(body);
}
const PDF = pdf();

export const IDS = {
  home: "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
  plan: "11111111111111111111111111111111",
  tasks: "22222222222222222222222222222222",
  spec: "33333333333333333333333333333333",
  review: "44444444444444444444444444444444",
};
const home = `Workspace Home ${IDS.home}`;
const homeUrl = `Workspace%20Home%20${IDS.home}`;
const tasks = `Tasks ${IDS.tasks}`;
const tasksUrl = `Tasks%20${IDS.tasks}`;

const CSV = `﻿Name,Status,Due,Done,Estimate,Link,Tags,Related
Write spec,In progress,"November 12, 2026",Yes,3,https://example.com/a,"design, docs",Project Plan (../Project%20Plan%20${IDS.plan}.md)
Review,Done,"November 14, 2026 → November 15, 2026",No,1.5,https://example.com/b,docs,
Ship,In progress,,No,,,,
`;

/** The files of the export, by path inside it. */
export function notionFiles(): Record<string, Uint8Array> {
  const text: Record<string, string> = {
    [`${home}.md`]: `# Workspace Home

Welcome to the **team** space. Start with [Project Plan](${homeUrl}/Project%20Plan%20${IDS.plan}.md).

<aside>
💡 Update the [Tasks](${homeUrl}/${tasksUrl}.csv) every week.

</aside>

- [ ] Draft agenda
- [x] Book room

> Plans are worthless, planning is everything.

\`\`\`python
print("hello")
\`\`\`

$$
E = mc^2
$$

| Phase | Weeks |
| --- | --- |
| Design | 2 |

---

![diagram.png](${homeUrl}/diagram.png)

[https://example.com/article](https://example.com/article)

[spec.pdf](${homeUrl}/spec.pdf)

[Tasks](${homeUrl}/${tasksUrl}.csv)

<details>
<summary>Background</summary>
See the [plan](${homeUrl}/Project%20Plan%20${IDS.plan}.md) and [an old page](Missing%20Page%2099999999999999999999999999999999.md).
</details>

<video src="clip.mp4"></video>
`,
    [`${home}/Project Plan ${IDS.plan}.md`]: `# Project Plan

Back to [Workspace Home](../${homeUrl}.md). The first task is [Write spec](https://www.notion.so/Write-spec-${IDS.spec}?pvs=21).
`,
    [`${home}/${tasks}.csv`]: CSV.split("\n").slice(0, 2).join("\n") + "\n",
    [`${home}/${tasks}_all.csv`]: CSV,
    [`${home}/${tasks}/Write spec ${IDS.spec}.md`]: `# Write spec

Status: In progress
Due: November 12, 2026
Done: Yes

Draft the spec, then go [home](../../${homeUrl}.md).
`,
    [`${home}/${tasks}/Review ${IDS.review}.md`]: `# Review

Status: Done

Review notes.
`,
    [`${home}/orphan.txt`]: "Nothing links here.",
  };
  return {
    ...Object.fromEntries(
      Object.entries(text).map(([path, value]) => [path, strToU8(value)]),
    ),
    [`${home}/diagram.png`]: PNG,
    [`${home}/spec.pdf`]: PDF,
  };
}

/** Notion's download: a zip holding Export-…-Part-1.zip. */
export function notionZip(): Uint8Array {
  const part = zipSync(notionFiles());
  return zipSync({ "Export-5f1c-Part-1.zip": part });
}

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const run = (text: string, properties = "") =>
  `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const listItem = (text: string, numId: number, level: number) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${run(text)}</w:p>`;
const cell = (text: string, properties = "") =>
  `<w:tc>${properties ? `<w:tcPr>${properties}</w:tcPr>` : ""}<w:p>${run(text)}</w:p></w:tc>`;

/** A Word document with each feature the importer maps. */
export function docxFile(): Uint8Array {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run("Quarterly Report")}</w:p>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run("Summary")}</w:p>
<w:p>${run("Plain, ")}${run("bold", "<w:b/>")}${run(", ")}${run("italic", "<w:i/>")}${run(", ")}${run("underlined", '<w:u w:val="single"/>')}${run(", ")}${run("struck", "<w:strike/>")}${run(", ")}${run("code()", '<w:rFonts w:ascii="Consolas"/>')}${run(" and ")}<w:hyperlink r:id="rId9">${run("a link", '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>${run(".")}<w:r><w:footnoteReference w:id="1"/></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${run("Steps")}</w:p>
${listItem("First", 2, 0)}${listItem("Detail A", 1, 1)}${listItem("Detail B", 1, 1)}${listItem("Second", 2, 0)}
<w:p><w:r><w:br w:type="page"/></w:r></w:p>
<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr>${cell("Region")}${cell("Q1")}${cell("Q2")}</w:tr>
<w:tr>${cell("North", '<w:vMerge w:val="restart"/>')}${cell("Both quarters", '<w:gridSpan w:val="2"/>')}</w:tr>
<w:tr>${cell("", "<w:vMerge/>")}${cell("10")}${cell("12")}</w:tr></w:tbl>
<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1" descr="Chart"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
<w:p><w:commentRangeStart w:id="0"/>${run("Reviewed text")}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>
</w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
</w:styles>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W}>
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/report" TargetMode="External"/>
</Relationships>`;
  const footnotes = `<?xml version="1.0" encoding="UTF-8"?><w:footnotes ${W}>
<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
<w:footnote w:id="1"><w:p>${run("Source: internal survey.")}</w:p></w:footnote>
</w:footnotes>`;
  const comments = `<?xml version="1.0" encoding="UTF-8"?><w:comments ${W}><w:comment w:id="0"><w:p>${run("Check this")}</w:p></w:comment></w:comments>`;
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ),
    "word/document.xml": strToU8(document),
    "word/styles.xml": strToU8(styles),
    "word/numbering.xml": strToU8(numbering),
    "word/_rels/document.xml.rels": strToU8(rels),
    "word/footnotes.xml": strToU8(footnotes),
    "word/comments.xml": strToU8(comments),
    "word/media/image1.png": PNG,
    "docProps/core.xml": strToU8(
      '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Quarterly Report</dc:title></cp:coreProperties>',
    ),
  });
}
