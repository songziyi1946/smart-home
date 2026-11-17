import { useEffect, useRef, useState } from "react";
export default function RangeControl({
  label,
  unit = "",
  value,
  min,
  max,
  step = 1,
  disabled,
  onSend,
}: {
  label: string;
  unit?: string;
  value?: number;
  min: number;
  max: number;
  step?: number;
  disabled: boolean;
  onSend: (n: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value ?? min);
  const dirty = useRef(false),
    editing = useRef(false),
    latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    if (!editing.current && !dirty.current) setDraft(value ?? min);
  }, [value, min]);
  useEffect(() => {
    if (disabled) {
      dirty.current = false;
      editing.current = false;
      setDraft(latest.current ?? min);
    }
  }, [disabled, min]);
  const cancel = () => {
    dirty.current = false;
    editing.current = false;
    setDraft(latest.current ?? min);
  };
  const submit = async (raw: string) => {
    editing.current = false;
    if (disabled) {
      cancel();
      return;
    }
    if (!dirty.current) return;
    dirty.current = false;
    try {
      if (!(await onSend(Number(raw)))) setDraft(latest.current ?? min);
    } catch {
      setDraft(latest.current ?? min);
    }
  };
  return (
    <label className="control-range">
      <span>
        {label}
        <output>当前 {value === undefined ? "暂无数据" : value + unit}</output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled || value === undefined}
        onPointerDown={() => {
          editing.current = true;
        }}
        onChange={(e) => {
          dirty.current = true;
          setDraft(Number(e.target.value));
        }}
        onPointerUp={(e) => void submit(e.currentTarget.value)}
        onPointerCancel={cancel}
        onKeyUp={(e) => {
          if (
            [
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "Home",
              "End",
            ].includes(e.key)
          )
            void submit(e.currentTarget.value);
        }}
        onBlur={(e) => void submit(e.currentTarget.value)}
      />
      <small>
        {value === undefined
          ? "暂无读数，状态恢复后可调节"
          : `调整至 ${draft}${unit} · 松手下发，以设备反馈为准`}
      </small>
    </label>
  );
}
