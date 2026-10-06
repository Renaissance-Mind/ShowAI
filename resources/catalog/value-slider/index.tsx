import { useEffect, useId, useState } from "react";

type Data = { label: string; value: number; min: number; max: number };

export default function ValueSlider({
  data,
  onChange,
  readOnly,
}: {
  data: Data;
  onChange?: (data: Data) => void;
  readOnly: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState(data.value);
  useEffect(() => setValue(data.value), [data.value]);
  const minimum = Math.min(data.min, data.max);
  const maximum = Math.max(data.min, data.max);
  return (
    <section
      style={{
        padding: "8px 0",
        color: "#294733",
      }}
    >
      <label
        htmlFor={id}
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <span>{data.label}</span>
        <output
          htmlFor={id}
          style={{ fontVariantNumeric: "tabular-nums", fontWeight: 650 }}
        >
          {value}
        </output>
      </label>
      <input
        id={id}
        type="range"
        min={minimum}
        max={maximum}
        step="any"
        value={value}
        style={{ width: "100%", accentColor: "#547c63" }}
        onChange={(event) => {
          const next = Number(event.target.value);
          setValue(next);
          if (!readOnly) onChange?.({ ...data, value: next });
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          color: "#657465",
        }}
      >
        <span>{minimum}</span>
        <span>{maximum}</span>
      </div>
    </section>
  );
}
