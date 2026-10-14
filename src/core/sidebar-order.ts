/** Unknown items retain their existing relative order after manually ordered items. */
export function orderSidebarItems<T extends { id: string }>(
  items: T[],
  order: string[] = [],
): T[] {
  const ranks = new Map(order.map((id, index) => [id, index]));
  return [...items].sort(
    (a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity),
  );
}

/** Legacy projects without a saved rank use immutable creation time, then identity. */
export function orderSidebarProjects<
  T extends { id: string; createdAt: string; pinned?: boolean },
>(projects: T[], order: string[] = []): T[] {
  const stable = [...projects].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  return orderSidebarItems(stable, order).sort(
    (a, b) => Number(!!b.pinned) - Number(!!a.pinned),
  );
}

export function placeSidebarItem(
  order: string[],
  id: string,
  relativeId?: string,
  placement: "before" | "after" = "before",
): string[] {
  const next = order.filter((item) => item !== id);
  const index = relativeId ? next.indexOf(relativeId) : next.length;
  if (index < 0) throw new Error("The destination item is missing.");
  next.splice(index + (relativeId && placement === "after" ? 1 : 0), 0, id);
  return next;
}
