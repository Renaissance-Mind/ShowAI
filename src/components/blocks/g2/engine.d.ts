export const g2Themes: Record<string, { base: string; palette: string[] }>;
export function createG2Context(
  container: HTMLElement,
  chartType: string,
  data: Record<string, unknown>,
  locked?: boolean,
): {
  render: () => Promise<void>;
  resize: () => Promise<void>;
  destroy: () => void;
};
