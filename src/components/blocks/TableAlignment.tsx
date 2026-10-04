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
