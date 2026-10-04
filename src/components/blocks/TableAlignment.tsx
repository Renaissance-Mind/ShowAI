import { createPortal } from "react-dom";
import { useTableHover, tableControlPositions } from "./table-hover";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";

export type TableAlignment = "left" | "center" | "right";

export function AlignmentButtons({
  scope,
  value,
  onChange,
}: {
  scope: string;
  value: string | null;
  onChange: (alignment: TableAlignment) => void;
}) {
  return (
    <div
      className="table-alignment-buttons"
      role="group"
      aria-label={`${scope}对齐`}
    >
      {(
        [
          ["left", "左对齐", AlignLeft],
          ["center", "居中", AlignCenter],
          ["right", "右对齐", AlignRight],
        ] as const
      ).map(([alignment, label, Icon]) => (
        <button
          key={alignment}
          type="button"
          aria-label={`${scope}${label}`}
          title={`${scope}${label}`}
          aria-pressed={value === alignment}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onChange(alignment);
          }}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

export function BasicTableControls({
  root,
  getAlignment,
  onChange,
}: {
  root: HTMLElement | null;
  getAlignment: (column: number | null) => string | null;
  onChange: (column: number | null, value: TableAlignment) => void;
}) {
  const { target, setTarget, owner } = useTableHover(root);
  if (!target?.table.isConnected) return null;
  const positions = tableControlPositions(target, 98);
  const align = (column: number | null, value: TableAlignment) => {
    onChange(column, value);
    if (target.context) setTarget(null);
  };
  return createPortal(
    <>
      <div
        className="table-hover-controls sb-table-global-alignment"
        data-table-controls-owner={owner}
        style={positions.global}
        role={target.context ? "dialog" : undefined}
        aria-label="表格对齐设置"
      >
        <AlignmentButtons
          scope="表格"
          value={getAlignment(null)}
          onChange={(value) => align(null, value)}
        />
      </div>
      {target.cell && !target.context && (
        <div
          className="table-hover-controls sb-table-column-alignment"
          data-table-controls-owner={owner}
          style={positions.column}
        >
          <AlignmentButtons
            scope={`第 ${target.cell.cellIndex + 1} 列`}
            value={getAlignment(target.cell.cellIndex)}
            onChange={(value) => align(target.cell!.cellIndex, value)}
          />
        </div>
      )}
    </>,
    document.body,
  );
}
