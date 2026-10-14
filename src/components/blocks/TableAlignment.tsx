import { createPortal } from "react-dom";
import { useTableHover, tableControlPositions } from "./table-hover";
import { AlignCenter, AlignLeft, AlignRight } from "../../ui/icons";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/blockHelpers";

export type TableAlignment = "left" | "center" | "right";

/**
 * "table" for the whole table, a zero-based column index for one column. Any
 * other string is an already translated scope name.
 */
export type AlignmentScope = "table" | number | string;

const alignments = [
  ["left", "Left", AlignLeft],
  ["center", "Center", AlignCenter],
  ["right", "Right", AlignRight],
] as const;

export function AlignmentButtons({
  scope,
  value,
  onChange,
}: {
  scope: AlignmentScope;
  value: string | null;
  onChange: (alignment: TableAlignment) => void;
}) {
  const t = useTranslator(messages);
  const label = (suffix: "Group" | "Left" | "Center" | "Right") =>
    scope === "table"
      ? t(`align.table${suffix}`)
      : typeof scope === "number"
        ? t(`align.column${suffix}`, { column: scope + 1 })
        : t(`align.scope${suffix}`, { scope });
  return (
    <div
      className="table-alignment-buttons"
      role="group"
      aria-label={label("Group")}
    >
      {alignments.map(([alignment, suffix, Icon]) => (
        <button
          key={alignment}
          type="button"
          aria-label={label(suffix)}
          title={label(suffix)}
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
  const t = useTranslator(messages);
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
        aria-label={t("align.settings")}
      >
        <AlignmentButtons
          scope="table"
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
            scope={target.cell.cellIndex}
            value={getAlignment(target.cell.cellIndex)}
            onChange={(value) => align(target.cell!.cellIndex, value)}
          />
        </div>
      )}
    </>,
    document.body,
  );
}
