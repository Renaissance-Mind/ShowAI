import { useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Gauge,
  Plus,
  Trash2,
} from "lucide-react";
import { finite, text } from "./helpers";
import { BlockHeader, EmptyState, Field } from "./shared";
import type { BlockProps } from "./types";

interface Metric {
  label: string;
  value: string | number;
  unit?: string;
  detail?: string;
  trend?: number;
}
export function MetricsBlock({ data, onChange, readOnly }: BlockProps) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftItems, setDraftItems] = useState<Metric[]>([]);
  const items: Metric[] = Array.isArray(data.items) ? data.items : [];
  const editable = Boolean(onChange && !readOnly);
  const openEditor = () => {
    setDraftTitle(text(data.title));
    setDraftItems(items.map((item) => ({ ...item })));
    setEditing(!editing);
  };
  const updateItem = (index: number, updates: Partial<Metric>) =>
    setDraftItems((current) =>
      current.map((item, currentIndex) =>
        currentIndex === index ? { ...item, ...updates } : item,
      ),
    );
  return (
    <section
      className="sb-block sb-metrics"
      aria-label={text(data.title) || "关键指标"}
    >
      <BlockHeader
        title={text(data.title)}
        defaultTitle="关键指标"
        icon={<Gauge size={17} />}
        editable={editable}
        editing={editing}
        onEdit={openEditor}
      />
      {editing && (
        <div className="sb-editor-panel">
          <Field label="标题">
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
            />
          </Field>
          <div className="sb-metric-editors">
            {draftItems.map((item, index) => (
              <div className="sb-metric-editor" key={index}>
                <div className="sb-form-row">
                  <Field label="名称">
                    <input
                      value={item.label}
                      onChange={(event) =>
                        updateItem(index, { label: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="数值">
                    <input
                      value={item.value}
                      onChange={(event) =>
                        updateItem(index, { value: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="单位">
                    <input
                      value={item.unit ?? ""}
                      onChange={(event) =>
                        updateItem(index, { unit: event.target.value })
                      }
                    />
                  </Field>
                </div>
                <div className="sb-form-row">
                  <Field label="说明">
                    <input
                      value={item.detail ?? ""}
                      onChange={(event) =>
                        updateItem(index, { detail: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="变化率 %（可留空）">
                    <input
                      type="number"
                      value={item.trend ?? ""}
                      onChange={(event) =>
                        updateItem(index, {
                          trend:
                            event.target.value === ""
                              ? undefined
                              : Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                  <button
                    type="button"
                    className="sb-icon-button sb-danger"
                    aria-label={`删除指标${item.label}`}
                    onClick={() =>
                      setDraftItems((current) =>
                        current.filter(
                          (_, currentIndex) => currentIndex !== index,
                        ),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="sb-panel-footer">
            <button
              type="button"
              className="sb-button"
              onClick={() =>
                setDraftItems((current) => [
                  ...current,
                  { label: "新指标", value: "" },
                ])
              }
            >
              <Plus size={14} />
              添加指标
            </button>
            <button
              type="button"
              className="sb-button sb-primary"
              onClick={() => {
                onChange?.({
                  ...data,
                  title: draftTitle,
                  items: draftItems.map(({ trend, ...item }) => ({
                    ...item,
                    ...(typeof trend === "number" && Number.isFinite(trend)
                      ? { trend }
                      : {}),
                  })),
                });
                setEditing(false);
              }}
            >
              <Check size={14} />
              保存
            </button>
          </div>
        </div>
      )}
      {items.length ? (
        <div className="sb-metric-grid">
          {items.map((item, index) => (
            <div className="sb-metric" key={index}>
              <span className="sb-metric-label">{text(item.label)}</span>
              <div className="sb-metric-value">
                {text(item.value, "—")}
                <span>{text(item.unit)}</span>
              </div>
              <div className="sb-metric-foot">
                {typeof item.trend === "number" && (
                  <span
                    className={`sb-trend ${item.trend < 0 ? "is-negative" : ""}`}
                  >
                    {item.trend < 0 ? (
                      <ArrowDownRight size={13} />
                    ) : (
                      <ArrowUpRight size={13} />
                    )}
                    {Math.abs(finite(item.trend))}%
                  </span>
                )}
                {item.detail && <span>{text(item.detail)}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Gauge size={28} strokeWidth={1.4} />}
          title="把关键数字放在眼前"
          description="每个指标可以包含数值、单位、说明和变化率。"
          action={
            editable && !editing ? (
              <button type="button" className="sb-button" onClick={openEditor}>
                <Plus size={14} />
                添加指标
              </button>
            ) : undefined
          }
        />
      )}
    </section>
  );
}
