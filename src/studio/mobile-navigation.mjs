export function mobileNavigationLayout(device, width, height, orientation) {
  const landscape = orientation ? orientation === "landscape" : width > height;
  const docked = device === "pad" && width >= 700 && landscape;
  return { docked, width: docked ? 240 : Math.min(280, width - 56) };
}

export function sidebarSwipe(start, end) {
  return start.x <= 24 && end.x - start.x >= 60 && Math.abs(end.y - start.y) <= 40;
}
