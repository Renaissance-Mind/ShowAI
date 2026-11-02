import { expect, test } from "vitest";
import { injectReadingOptions } from "./reading-preview";
test("reading options do not corrupt bundled HTML literals or permit script termination", () => {
  const script =
    '<script type="module">const fragment="</head>";const template="<head>inner</head>";</script>';
  const html = `<html><head><title>Reader</title>${script}</head><body></body></html>`;
  const output = injectReadingOptions(html, {
    label: "</script><script>unsafe()</script>",
    theme: "dark",
  });
  expect(output).toContain(script);
  expect(
    output.startsWith('<html><head><script id="showai-read-options"'),
  ).toBe(true);
  const payload = output.match(
    /id="showai-read-options" type="application\/json">(.*?)<\/script>/,
  )![1];
  expect(payload).not.toContain("<");
  expect(JSON.parse(payload).label).toBe("</script><script>unsafe()</script>");
  expect(() => injectReadingOptions("<body></body>", {})).toThrow(
    "no document head",
  );
});
