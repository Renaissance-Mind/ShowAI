export function injectReadingOptions(html: string, options: unknown): string {
  const head = /<head\b[^>]*>/i;
  if (!head.test(html))
    throw new Error("The reader HTML has no document head.");
  const payload = JSON.stringify(options).replaceAll("<", "\\u003c");
  return html.replace(
    head,
    (open) =>
      `${open}<script id="showai-read-options" type="application/json">${payload}</script>`,
  );
}

