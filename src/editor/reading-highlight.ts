import Highlight from "@tiptap/extension-highlight";

/** Keep the native colour attribute while CSS paints the lower part of each line. */
export const ReadingHighlight = Highlight.extend({
  addAttributes() {
    const attributes = this.parent?.() ?? {};
    if (!this.options.multicolor) return attributes;
    return {
      ...attributes,
      color: {
        ...attributes.color,
        renderHTML: ({ color }) =>
          color
            ? {
                "data-color": color,
                style: `--showai-highlight-color: ${color}`,
              }
            : {},
      },
    };
  },
});
