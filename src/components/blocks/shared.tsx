import { Settings2, X } from "lucide-react";
import type { ReactNode } from "react";

export function BlockHeader({
  title,
  description,
  icon,
  editable,
  editing,
  onEdit,
  children,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  editable?: boolean;
  editing?: boolean;
  onEdit?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="sb-header">
      <div className="sb-heading">
        <div className="sb-title">
          {icon}
          {title}
        </div>
        {description && <p className="sb-description">{description}</p>}
      </div>
      <div className="sb-actions">
        {children}
        {editable && (
          <button
            type="button"
            className={`sb-icon-button ${editing ? "is-active" : ""}`}
            onClick={onEdit}
            aria-label={editing ? "关闭设置" : "编辑区块"}
            title={editing ? "关闭设置" : "编辑区块"}
          >
            {editing ? <X size={16} /> : <Settings2 size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="sb-empty">
      {icon}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`sb-field ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
