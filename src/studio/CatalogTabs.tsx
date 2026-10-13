import { useId, useRef } from "react";

export default function CatalogTabs<T extends string>({
  label,
  tabs,
  active,
  onChange,
  panelId,
}: {
  label: string;
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  panelId?: string;
}) {
  const id = useId();
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  return (
    <nav
      className="studio-detail-tabs catalog-tabs"
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        const index = tabs.findIndex((tab) => tab.id === active);
        const next =
          event.key === "ArrowRight"
            ? (index + 1) % tabs.length
            : event.key === "ArrowLeft"
              ? (index + tabs.length - 1) % tabs.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : -1;
        if (next < 0) return;
        event.preventDefault();
        onChange(tabs[next].id);
        buttons.current.get(tabs[next].id)?.focus();
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`${id}-${tab.id}`}
          ref={(el) => {
            if (el) buttons.current.set(tab.id, el);
            else buttons.current.delete(tab.id);
          }}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          aria-controls={panelId}
          tabIndex={active === tab.id ? 0 : -1}
          className={active === tab.id ? "active" : ""}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
