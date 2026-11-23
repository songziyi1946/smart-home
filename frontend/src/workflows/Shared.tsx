import { StatusPanel } from "../ui/StatusPanel";
import { useState } from "react";
import type { ReactNode } from "react";
import type { Capability, SceneRun, DeviceSnapshot } from "../types";
import { valueChoices, runLabels, deviceName, actionText } from "./model";
import type { Scalar } from "./model";
export function ValueField({
  label,
  capability,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  capability: Capability;
  value: Scalar | undefined;
  onChange: (v: Scalar | undefined) => void;
  disabled?: boolean;
}) {
  const choices = valueChoices[capability];
  return (
    <label className="flow-field">
      {label}
      {choices ? (
        <select
          aria-label={label}
          value={value === undefined ? "" : String(value)}
          disabled={disabled}
          required
          onChange={(e) =>
            onChange(choices.find(([v]) => String(v) === e.target.value)?.[0])
          }
        >
          <option value="" disabled>
            请选择
          </option>
          {choices.map(([v, n]) => (
            <option key={String(v)} value={String(v)}>
              {n}
            </option>
          ))}
        </select>
      ) : (
        <input
          aria-label={label}
          type="number"
          step="any"
          required
          disabled={disabled}
          value={value === undefined ? "" : String(value)}
          onChange={(e) =>
            onChange(e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      )}
    </label>
  );
}
export function SceneResult({
  run,
  devices,
}: {
  run: SceneRun;
  devices: DeviceSnapshot[];
}) {
  return (
    <div className="flow-run-detail">
      <p className={"flow-status " + run.status}>
        {runLabels[run.status]}
        {run.reason ? " · " + run.reason : ""}
      </p>
      <ol className="flow-timeline">
        {run.actions.map((a, i) => (
          <li key={i} className={a.status}>
            <span className="flow-step-number">{i + 1}</span>
            <div>
              <strong>{deviceName(devices, a.deviceId)}</strong>
              <p>{actionText(a.command)}</p>
              <span>
                {
                  {
                    pending: "待执行",
                    executing: "下发中",
                    sent: "已下发",
                    failed: "失败",
                    skipped: "未执行",
                  }[a.status]
                }
              </span>
              {a.reason && <p className="flow-failure">{a.reason}</p>}
            </div>
          </li>
        ))}
      </ol>
      {run.status === "failed" && (
        <p>
          <a href="#devices">检查设备状态 →</a>
        </p>
      )}
      {run.status === "failed" && <small>已执行的动作不会自动回滚。</small>}
    </div>
  );
}
type Log = {
  id: string;
  name: string;
  status: keyof typeof runLabels;
  startedAt: string;
  reason?: string;
};
export function History<T extends Log>({
  runs,
  render,
  initialRunId,
}: {
  runs: T[];
  initialRunId?: string;
  render: (run: T) => ReactNode;
}) {
  const [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<string | undefined>(initialRunId),
    [limit, setLimit] = useState(() =>
      Math.max(20, runs.findIndex((r) => r.id === initialRunId) + 1),
    );
  const visible = runs.filter((r) => filter === "all" || r.status === filter),
    current = visible.find((r) => r.id === selected) ?? visible[0];
  return (
    <section className="panel flow-history">
      <div className="flow-heading">
        <h2>执行记录</h2>
        <label>
          结果
          <select
            aria-label="筛选执行结果"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSelected(undefined);
              setLimit(20);
            }}
          >
            <option value="all">全部</option>
            {Object.entries(runLabels).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!visible.length ? (
        <StatusPanel
          compact
          kind="empty"
          title="暂无执行记录"
        />
      ) : (
        <div className="flow-history-layout">
          <div className="flow-log-list" aria-label="执行记录列表">
            {visible.slice(0, limit).map((run) => (
              <button
                key={run.id}
                aria-pressed={current?.id === run.id}
                onClick={() => setSelected(run.id)}
              >
                <span className={"flow-status " + run.status}>
                  {runLabels[run.status]}
                </span>
                <strong>{run.name}</strong>
                <small>{new Date(run.startedAt).toLocaleString("zh-CN")}</small>
                {run.reason && <small>{run.reason}</small>}
              </button>
            ))}
            {visible.length > limit && (
              <button onClick={() => setLimit(limit + 20)}>显示更多记录</button>
            )}
          </div>
          <div className="flow-log-inspector">{current && render(current)}</div>
        </div>
      )}
    </section>
  );
}
