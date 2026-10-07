import { useId, useState } from "react";
import { Check, FlaskConical, Plus, RotateCcw, Trash2 } from "../../ui/icons";
import { finite, text, uid } from "./helpers";
import { BlockHeader, Field } from "./shared";
import type { BlockProps } from "./types";

interface Parameter {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
}
const OPERATIONS = [
  { value: "sum", label: "求和" },
  { value: "product", label: "乘积" },
  { value: "average", label: "平均值" },
];
export function calculate(inputs: number[], operation: string): number {
  if (!inputs.length) return 0;
  if (operation === "product")
    return inputs.reduce((result, value) => result * value, 1);
  const total = inputs.reduce((result, value) => result + value, 0);
  return operation === "average" ? total / inputs.length : total;
}
export function PlaygroundBlock({ data, onChange, readOnly }: BlockProps) {
  const controlId = useId();
  const inputs: Parameter[] = Array.isArray(data.inputs) ? data.inputs : [];
  const [values, setValues] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    resultLabel: "",
    unit: "",
    operation: "sum",
  });
  const [draftInputs, setDraftInputs] = useState<Parameter[]>([]);
  const [error, setError] = useState("");
  const editable = Boolean(onChange && !readOnly);
  const currentValue = (input: Parameter) =>
    Math.min(
      input.max,
      Math.max(input.min, values[input.id] ?? finite(input.value)),
    );
  const result = calculate(
    inputs.map(currentValue),
    text(data.operation, "sum"),
  );
  const formattedResult = Number.isFinite(result)
    ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(
        result,
      )
    : "超出数值范围";
  const openEditor = () => {
    setDraft({
      title: text(data.title, "交互计算"),
      resultLabel: text(data.resultLabel, "计算结果"),
      unit: text(data.unit),
      operation: text(data.operation, "sum"),
    });
    setDraftInputs(inputs.map((input) => ({ ...input })));
    setError("");
    setEditing(!editing);
  };
  const save = () => {
    if (
      draftInputs.some(
        (input) =>
          !input.label.trim() ||
          ![input.min, input.max, input.step, input.value].every(
            Number.isFinite,
          ) ||
          input.min >= input.max ||
          input.step <= 0,
      )
    ) {
      setError("每个参数需要名称，最大值须大于最小值，步长须大于 0。");
      return;
    }
    onChange?.({
      ...data,
      ...draft,
      inputs: draftInputs.map((input) => ({
        ...input,
        value: Math.min(input.max, Math.max(input.min, input.value)),
      })),
    });
    setValues({});
    setEditing(false);
  };
  const updateDraftInput = (index: number, changes: Partial<Parameter>) =>
    setDraftInputs((current) =>
      current.map((input, currentIndex) =>
        currentIndex === index ? { ...input, ...changes } : input,
      ),
    );
  return (
    <section
      className="sb-block sb-playground"
      aria-label={text(data.title) || "交互计算"}
    >
      <BlockHeader
        title={text(data.title)}
        defaultTitle="交互计算"
        description={text(data.description)}
        icon={<FlaskConical size={17} />}
        editable={editable}
        editing={editing}
        onEdit={openEditor}
      >
        <button
          type="button"
          className="sb-icon-button"
          aria-label="重置参数"
          title="重置参数"
          onClick={() => setValues({})}
        >
          <RotateCcw size={15} />
        </button>
      </BlockHeader>
      {editing && (
        <div className="sb-editor-panel">
          <div className="sb-form-row">
            <Field label="标题">
              <input
                value={draft.title}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="计算方式">
              <select
                value={draft.operation}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    operation: event.target.value,
                  }))
                }
              >
                {OPERATIONS.map((operation) => (
                  <option key={operation.value} value={operation.value}>
                    {operation.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="sb-form-row">
            <Field label="结果名称">
              <input
                value={draft.resultLabel}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    resultLabel: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="结果单位">
              <input
                value={draft.unit}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    unit: event.target.value,
                  }))
                }
              />
            </Field>
          </div>
          {draftInputs.map((input, index) => (
            <div className="sb-parameter-editor" key={input.id}>
              <div className="sb-form-row">
                <Field label="参数名称">
                  <input
                    value={input.label}
                    onChange={(event) =>
                      updateDraftInput(index, { label: event.target.value })
                    }
                  />
                </Field>
                <Field label="单位">
                  <input
                    value={input.unit ?? ""}
                    onChange={(event) =>
                      updateDraftInput(index, { unit: event.target.value })
                    }
                  />
                </Field>
                <button
                  type="button"
                  className="sb-icon-button sb-danger"
                  aria-label={`删除参数${input.label}`}
                  onClick={() =>
                    setDraftInputs((current) =>
                      current.filter(
                        (_, currentIndex) => currentIndex !== index,
                      ),
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="sb-form-row">
                {(["min", "max", "step", "value"] as const).map(
                  (key, keyIndex) => (
                    <Field
                      key={key}
                      label={["最小值", "最大值", "步长", "初始值"][keyIndex]}
                    >
                      <input
                        type="number"
                        value={input[key]}
                        onChange={(event) =>
                          updateDraftInput(index, {
                            [key]:
                              event.target.value === ""
                                ? 0
                                : Number(event.target.value),
                          })
                        }
                      />
                    </Field>
                  ),
                )}
              </div>
            </div>
          ))}
          {error && (
            <p className="sb-error" role="alert">
              {error}
            </p>
          )}
          <div className="sb-panel-footer">
            <button
              type="button"
              className="sb-button"
              onClick={() =>
                setDraftInputs((current) => [
                  ...current,
                  {
                    id: uid(),
                    label: "新参数",
                    min: 0,
                    max: 100,
                    step: 1,
                    value: 0,
                  },
                ])
              }
            >
              <Plus size={14} />
              添加参数
            </button>
            <button
              type="button"
              className="sb-button sb-primary"
              onClick={save}
            >
              <Check size={14} />
              保存
            </button>
          </div>
        </div>
      )}
      <div className="sb-playground-body">
        <div className="sb-parameters">
          {inputs.length ? (
            inputs.map((input) => (
              <div className="sb-parameter" key={input.id}>
                <div className="sb-parameter-label">
                  <label htmlFor={`${controlId}-param-${input.id}`}>
                    {input.label}
                  </label>
                  <div>
                    <input
                      aria-label={`${input.label}数值`}
                      type="number"
                      min={input.min}
                      max={input.max}
                      step={input.step}
                      value={currentValue(input)}
                      onChange={(event) => {
                        if (event.target.value === "") return;
                        setValues((current) => ({
                          ...current,
                          [input.id]: Math.min(
                            input.max,
                            Math.max(input.min, Number(event.target.value)),
                          ),
                        }));
                      }}
                    />
                    <span>{input.unit}</span>
                  </div>
                </div>
                <input
                  id={`${controlId}-param-${input.id}`}
                  aria-label={input.label}
                  type="range"
                  min={input.min}
                  max={input.max}
                  step={input.step}
                  value={currentValue(input)}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [input.id]: Number(event.target.value),
                    }))
                  }
                  style={
                    {
                      "--range-progress": `${((currentValue(input) - input.min) / (input.max - input.min)) * 100}%`,
                    } as React.CSSProperties
                  }
                />
                <div className="sb-range-labels">
                  <span>
                    {input.min}
                    {input.unit}
                  </span>
                  <span>
                    {input.max}
                    {input.unit}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="sb-empty">
              <FlaskConical size={26} />
              <strong>试着改变一个变量</strong>
              {editable && !editing && (
                <button
                  type="button"
                  className="sb-button"
                  onClick={openEditor}
                >
                  设置参数
                </button>
              )}
            </div>
          )}
        </div>
        <div className="sb-calculation-result">
          <span>{text(data.resultLabel, "计算结果")}</span>
          <strong aria-live="polite">
            {formattedResult}
            <small>{text(data.unit)}</small>
          </strong>
          <span className="sb-formula">
            {inputs.length
              ? inputs
                  .map((input) => input.label)
                  .join(data.operation === "product" ? " × " : " + ") +
                (data.operation === "average" ? `，÷ ${inputs.length}` : "")
              : "等待设置参数"}
          </span>
        </div>
      </div>
    </section>
  );
}
