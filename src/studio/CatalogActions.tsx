import { useState } from "react";
import { MoreHorizontal } from "../ui/icons";
import {
  LibraryContextMenu,
  type LibraryContextMenuItem,
} from "./LibraryNavigation";
export default function CatalogActions({
  items,
}: {
  items: LibraryContextMenuItem[];
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!items.length) return null;
  return (
    <>
      <button
        type="button"
        className="studio-icon"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <MoreHorizontal size={18} />
      </button>
      {anchor && (
        <LibraryContextMenu
          label="目录对象操作"
          anchor={anchor}
          items={items}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}
