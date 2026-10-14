export function mobileNavigationLayout(
  device: string | undefined,
  width: number,
  height: number,
  orientation?: string,
  board?: boolean,
): { docked: boolean; width: number };
export function sidebarSwipe(
  start: { x: number; y: number },
  end: { x: number; y: number },
): boolean;
