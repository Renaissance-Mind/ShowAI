import type { SidebarOrganization } from "../core/model";
import { orderSidebarItems, placeSidebarItem } from "../core/sidebar-order";

export interface SidebarReorder {
  projectId: string;
  id: string;
  siblings: string[];
  relativeId?: string;
  placement?: "before" | "after";
}

/** Replay pending gestures over the latest confirmed order, including after a failed save. */
export function applySidebarReorder(
  organization: SidebarOrganization,
  move: SidebarReorder,
): SidebarOrganization {
  const previous = organization.entryOrder?.[move.projectId] ?? [];
  const siblings = placeSidebarItem(
    orderSidebarItems(
      move.siblings.map((id) => ({ id })),
      previous,
    ).map(({ id }) => id),
    move.id,
    move.relativeId,
    move.placement,
  );
  const siblingIds = new Set(siblings);
  return {
    ...organization,
    entryOrder: {
      ...organization.entryOrder,
      [move.projectId]: [
        ...previous.filter((id) => !siblingIds.has(id)),
        ...siblings,
      ],
    },
  };
}
