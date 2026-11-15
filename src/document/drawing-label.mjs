export const LABEL_TOOLS = ["rectangle", "ellipse", "arrow"];
export const DEFAULT_LABEL_SIZE = 16;
export const MAX_LABEL_LENGTH = 2000;
export const LABEL_LINE_HEIGHT = 1.3;
export const LABEL_SIZES = [14, 16, 22, 30];

export function labelCapable(node) {
  return (
    node?.type === "drawing" &&
    LABEL_TOOLS.includes(node.attrs?.tool) &&
    !node.attrs?.ink
  );
}

export function labelPadding(tool, strokeWidth = 2) {
  return tool === "arrow" ? 4 : Math.max(8, strokeWidth + 6);
}

export function labelBox(tool, width, height, strokeWidth = 2) {
  const pad = labelPadding(tool, strokeWidth);
  if (tool === "ellipse") {
    const inset = (1 - Math.SQRT1_2) / 2;
    return {
      x: width * inset + pad / 2,
      y: height * inset + pad / 2,
      width: Math.max(1, width * Math.SQRT1_2 - pad),
      height: Math.max(1, height * Math.SQRT1_2 - pad),
    };
  }
  return {
    x: pad,
    y: pad,
    width: Math.max(1, width - pad * 2),
    height: Math.max(1, height - pad * 2),
  };
}

const wide =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;

function charWidth(char) {
  if (wide.test(char)) return 1;
  if (char === " ") return 0.3;
  return /[A-Z0-9MW@#%&]/.test(char) ? 0.64 : 0.54;
}

export function estimateLabel(text, fontSize = DEFAULT_LABEL_SIZE, maxWidth) {
  let lines = 0,
    widest = 0;
  for (const line of String(text).split("\n")) {
    let width = 0,
      count = 1;
    for (const char of line) {
      const next = charWidth(char) * fontSize;
      if (maxWidth && width + next > maxWidth && width > 0) {
        widest = Math.max(widest, width);
        width = next;
        count++;
      } else width += next;
    }
    widest = Math.max(widest, width);
    lines += count;
  }
  return {
    width: Math.ceil(widest),
    height: Math.ceil(lines * fontSize * LABEL_LINE_HEIGHT),
  };
}

export function labelledShapeSize(
  tool,
  label,
  fontSize = DEFAULT_LABEL_SIZE,
  strokeWidth = 2,
) {
  const pad = labelPadding(tool, strokeWidth);
  const scale = tool === "ellipse" ? Math.SQRT2 : 1;
  const minimum = { width: 160, height: 72 };
  if (!label) return minimum;
  const natural = estimateLabel(label, fontSize);
  const width = Math.min(
    360,
    Math.max(minimum.width, Math.ceil((natural.width + pad * 2) * scale)),
  );
  const text = estimateLabel(label, fontSize, width / scale - pad * 2);
  return {
    width,
    height: Math.max(minimum.height, Math.ceil((text.height + pad * 2) * scale)),
  };
}

export function labelFitHeight(
  tool,
  label,
  fontSize = DEFAULT_LABEL_SIZE,
  width,
  strokeWidth = 2,
) {
  const pad = labelPadding(tool, strokeWidth);
  const scale = tool === "ellipse" ? Math.SQRT2 : 1;
  const text = estimateLabel(label, fontSize, width / scale - pad * 2);
  return Math.ceil((text.height + pad * 2) * scale);
}
