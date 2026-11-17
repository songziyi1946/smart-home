import { StatusPanel } from "../ui/StatusPanel";
import { useConfirmAction } from "../ui/useConfirmAction";
import { useRef, useState } from "react";
import { Button, Switch } from "@arco-design/web-react";
import { Plus, Zap, ArrowLeft } from "lucide-react";
import type { State, Mutate, Capability } from "../types";
import type {
  AutomationRule,
  AutomationInput,
} from "../../../packages/contracts/automations";
import { request } from "../api";
import { useMobile } from "../mobile/hooks";
import { History, SceneResult, ValueField } from "../workflows/Shared";
import {
  capabilityLabels,
  initialValue,
  valueText,
  deviceName,
  windowText,
  previewInstant,
  runLabels,
} from "../workflows/model";
import type { Scalar } from "../workflows/model";
import "../workflows/style.css";
type Preview = {
  reason: string;
  wouldRun: boolean;
  triggerMatches: boolean;
  timeMatches: boolean;
  evaluatedAt: string;
  timeZone: string;
  note: string;
  scene?: State["scenes"][number];
};
function Steps({ rule, state }: { rule: AutomationInput; state: State }) {
  return (
    <ol className="rule-sentence">
      <li>
        <b>当</b>
        <span>
          {deviceName(state.devices, rule.trigger.deviceId)}
          <strong>
            {capabilityLabels[rule.trigger.capability]}
            {rule.trigger.from !== undefined
              ? "从“" +
                valueText(rule.trigger.capability, rule.trigger.from) +
                "”"
              : ""}
            变为“{valueText(rule.trigger.capability, rule.trigger.to)}”
          </strong>
        </span>
      </li>
      <li>
        <b>且</b>
        <span>
          处于 {windowText(rule.condition.start, rule.condition.end)}
          <small>{rule.condition.timeZone}</small>
        </span>
      </li>
      <li>
        <b>就</b>
        <span>
          执行场景
          <strong>
            {state.scenes.find((s) => s.id === rule.action.sceneId)?.name ??
              "场景已删除"}
          </strong>
        </span>
      </li>
    </ol>
  );
}
export default function Rules({
  state,
  busy,
  pending = false,
  mutate,
  canManage,
}: {
  state: State;
  busy: boolean;
  pending?: boolean;
  mutate: Mutate;
  canManage: boolean;
}) {
  const confirmation = useConfirmAction(busy);
  const mobile = useMobile(),
    [draft, setDraft] = useState<AutomationRule>(),
    [preview, setPreview] = useState<Preview>(),
    [error, setError] = useState(""),
    [at, setAt] = useState(""),
    [from, setFrom] = useState<Scalar>(),
    [previewBusy, setPreviewBusy] = useState(false),
    [focusedRun, setFocusedRun] = useState<string>(),
    [tab, setTab] = useState("rules");
  const revision = useRef(0),
    requestId = useRef(0);
  const invalidate = () => {
    revision.current++;
    setPreview(undefined);
  };
  const open = (rule?: AutomationRule) => {
    invalidate();
    requestId.current++;
    setPreviewBusy(false);
    setError("");
    setAt("");
    if (rule) {
      setDraft(structuredClone(rule));
      setFrom(
        state.devices.find((d) => d.id === rule.trigger.deviceId)?.state.values[
          rule.trigger.capability
        ],
      );
    } else {
      const device =
        state.devices.find((d) => d.capabilities.includes("occupancy")) ??
        state.devices[0];
      if (!device) return;
      const c = device.capabilities.includes("occupancy")
        ? "occupancy"
        : device.capabilities[0];
      setFrom(device.state.values[c]);
      setDraft({
        id: "",
        version: 0,
        createdBy: "",
        schemaVersion: 1,
        name: "",
        enabled: false,
        trigger: {
          type: "device_state_changed",
          deviceId: device.id,
          capability: c,
          to: initialValue(c),
        },
        condition: {
          type: "time_window",
          start: "22:00",
          end: "06:30",
          timeZone: "Asia/Shanghai",
        },
        action: { type: "run_scene", sceneId: state.scenes[0]?.id ?? "" },
        executionPolicy: { mode: "single", cooldownSeconds: 30 },
      });
    }
  };
  const input = (): AutomationInput => {
    const { id, version, createdBy, ...body } = draft!;
    return body;
  };
  const change = (patch: Partial<AutomationRule>) => {
    invalidate();
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };
  const close = () => {
    invalidate();
    requestId.current++;
    setPreviewBusy(false);
    setDraft(undefined);
  };
  async function previewRule() {
    const currentRevision = revision.current,
      id = ++requestId.current;
    setPreviewBusy(true);
    setError("");
    setPreview(undefined);
    try {
      if (from === undefined)
        throw Error("请选择预览旧值；预览不会把它写入设备。");
      const instant = previewInstant(at);
      const result = await request<Preview>("/automations/preview", "POST", {
        rule: input(),
        event: { from, to: draft!.trigger.to },
        ...(instant ? { at: instant } : {}),
      });
      if (revision.current === currentRevision && requestId.current === id)
        setPreview(result);
    } catch (e) {
      if (revision.current === currentRevision && requestId.current === id)
        setError(e instanceof Error ? e.message : "预览失败");
    } finally {
      if (requestId.current === id) setPreviewBusy(false);
    }
  }
  if (draft)
    return (
      <div className={"flow-rule-editor " + (mobile ? "flow-mobile" : "")}>
        <section className="panel flow-editor">
          <div className="flow-heading">
            <div>
              <small>自动化 / {draft.id ? "编辑规则" : "创建规则"}</small>
              <h2>何时发生，家里如何响应</h2>
            </div>
            <Button
              disabled={pending}
              icon={<ArrowLeft size={16} />}
              onClick={close}
            >
              返回规则
            </Button>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              if (
                await mutate(
                  "/automations" + (draft.id ? "/" + draft.id : ""),
                  draft.id ? "PUT" : "POST",
                  {
                    ...input(),
                    ...(draft.id ? { version: draft.version } : {}),
                  },
                )
              )
                close();
              else
                setError("保存未完成，请查看页面提示；版本冲突时请重新打开。");
            }}
          >
            <fieldset disabled={busy || !canManage}>
              <label className="flow-field">
                规则名称
                <input
                  required
                  maxLength={80}
                  value={draft.name}
                  onChange={(e) => change({ name: e.target.value })}
                />
              </label>
              <section className="flow-editor-step">
                <h3>
                  <b>当</b>设备状态发生变化
                </h3>
                <div className="flow-form-pair">
                  <label className="flow-field">
                    触发设备
                    <select
                      value={draft.trigger.deviceId}
                      onChange={(e) => {
                        const d = state.devices.find(
                          (d) => d.id === e.target.value,
                        )!;
                        const c = d.capabilities[0];
                        change({
                          trigger: {
                            type: "device_state_changed",
                            deviceId: d.id,
                            capability: c,
                            to: initialValue(c),
                          },
                        });
                        setFrom(d.state.values[c]);
                      }}
                    >
                      {!state.devices.some(
                        (d) => d.id === draft.trigger.deviceId,
                      ) && (
                        <option value={draft.trigger.deviceId}>
                          设备已移除
                        </option>
                      )}
                      {state.devices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} · {d.room}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flow-field">
                    观察什么
                    <select
                      value={draft.trigger.capability}
                      onChange={(e) => {
                        const c = e.target.value as Capability;
                        change({
                          trigger: {
                            type: "device_state_changed",
                            deviceId: draft.trigger.deviceId,
                            capability: c,
                            to: initialValue(c),
                          },
                        });
                        setFrom(
                          state.devices.find(
                            (d) => d.id === draft.trigger.deviceId,
                          )?.state.values[c],
                        );
                      }}
                    >
                      {[
                        ...new Set([
                          draft.trigger.capability,
                          ...(state.devices.find(
                            (d) => d.id === draft.trigger.deviceId,
                          )?.capabilities ?? []),
                        ]),
                      ].map((c) => (
                        <option key={c} value={c}>
                          {capabilityLabels[c]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <ValueField
                  label="变化后的值"
                  capability={draft.trigger.capability}
                  value={draft.trigger.to}
                  onChange={(value) =>
                    change({ trigger: { ...draft.trigger, to: value ?? "" } })
                  }
                />
                <label className="flow-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.trigger.from !== undefined}
                    onChange={(e) => {
                      const { from: old, ...trigger } = draft.trigger;
                      change({
                        trigger: e.target.checked
                          ? {
                              ...trigger,
                              from: initialValue(trigger.capability),
                            }
                          : trigger,
                      });
                    }}
                  />
                  限定变化前的值
                </label>
                {draft.trigger.from !== undefined && (
                  <ValueField
                    label="变化前必须是"
                    capability={draft.trigger.capability}
                    value={draft.trigger.from}
                    onChange={(value) =>
                      change({
                        trigger: { ...draft.trigger, from: value ?? "" },
                      })
                    }
                  />
                )}
                <p className="flow-hint">
                  精确匹配值变化，不是阈值判断。首次发现和离线恢复不会触发。
                </p>
              </section>
              <section className="flow-editor-step">
                <h3>
                  <b>且</b>处于允许的时间段
                </h3>
                <div className="flow-form-pair">
                  <label className="flow-field">
                    开始时间
                    <input
                      type="time"
                      required
                      value={draft.condition.start}
                      onInput={(e) =>
                        change({
                          condition: {
                            ...draft.condition,
                            start: e.currentTarget.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="flow-field">
                    结束时间
                    <input
                      type="time"
                      required
                      value={draft.condition.end}
                      onInput={(e) =>
                        change({
                          condition: {
                            ...draft.condition,
                            end: e.currentTarget.value,
                          },
                        })
                      }
                    />
                  </label>
                </div>
                <p className="flow-hint">
                  {windowText(draft.condition.start, draft.condition.end)}
                  ，包含开始时刻，不包含结束时刻。
                </p>
              </section>
              <section className="flow-editor-step">
                <h3>
                  <b>就</b>调用已有场景
                </h3>
                <label className="flow-field">
                  执行场景
                  <select
                    required
                    value={draft.action.sceneId}
                    onChange={(e) =>
                      change({
                        action: { type: "run_scene", sceneId: e.target.value },
                      })
                    }
                  >
                    {!state.scenes.some(
                      (s) => s.id === draft.action.sceneId,
                    ) && <option value="">请选择场景</option>}
                    {state.scenes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.actions.length}个动作
                      </option>
                    ))}
                  </select>
                </label>
              </section>
              <details className="flow-advanced">
                <summary>时区与重复触发设置</summary>
                <label className="flow-field">
                  时区
                  <input
                    required
                    value={draft.condition.timeZone}
                    onChange={(e) =>
                      change({
                        condition: {
                          ...draft.condition,
                          timeZone: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                <label className="flow-field">
                  冷却时间（秒）
                  <input
                    type="number"
                    min={1}
                    max={3600}
                    required
                    value={draft.executionPolicy.cooldownSeconds}
                    onChange={(e) =>
                      change({
                        executionPolicy: {
                          mode: "single",
                          cooldownSeconds: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <p className="flow-hint">
                  单次执行，冷却期间跳过重复触发；失败不会自动重试。
                </p>
              </details>
              <div className="flow-save">
                <label className="flow-checkbox">
                  保存后启用
                  <Switch
                    checked={draft.enabled}
                    onChange={(enabled) => change({ enabled })}
                  />
                </label>
                <Button
                  htmlType="submit"
                  type="primary"
                  loading={pending}
                  disabled={previewBusy}
                >
                  保存规则
                </Button>
              </div>
              {error && (
                <p role="alert" className="flow-failure">
                  {error}
                </p>
              )}
            </fieldset>
          </form>
        </section>
        <aside className="panel flow-preview">
          <h2>规则预览</h2>
          <Steps rule={draft} state={state} />
          <div className="flow-notice">
            只检查条件，不执行场景，不改变设备。
          </div>
          <ValueField
            label="模拟变化前的值"
            capability={draft.trigger.capability}
            value={from}
            disabled={busy}
            onChange={(value) => {
              invalidate();
              setFrom(value);
            }}
          />
          <label className="flow-field">
            模拟时刻（{Intl.DateTimeFormat().resolvedOptions().timeZone}）
            <input
              type="datetime-local"
              value={at}
              onInput={(e) => {
                invalidate();
                setAt(e.currentTarget.value);
              }}
            />
            <small>留空使用当前时刻；条件按规则时区判断。</small>
          </label>
          <Button
            type="primary"
            long
            disabled={busy || !canManage}
            loading={previewBusy}
            onClick={() => void previewRule()}
          >
            检查是否会触发（不执行）
          </Button>
          {preview && (
            <div className="flow-preview-result" role="status">
              <h3>
                {preview.wouldRun ? "条件满足，将调用场景" : "本次不会执行"}
              </h3>
              <ul>
                <li>规则：{draft.enabled ? "已启用" : "已禁用"}</li>
                <li>状态变化：{preview.triggerMatches ? "匹配" : "不匹配"}</li>
                <li>时间条件：{preview.timeMatches ? "匹配" : "不匹配"}</li>
              </ul>
              <p>{preview.reason}</p>
              <small>
                判定时刻{" "}
                {new Date(preview.evaluatedAt).toLocaleString("zh-CN", {
                  timeZone: preview.timeZone,
                })}{" "}
                · {preview.timeZone}
              </small>
              <p>{preview.note}</p>
            </div>
          )}
        </aside>
      </div>
    );
  return (
    <div className={"flow-page " + (mobile ? "flow-mobile" : "")}>
      <div className="flow-heading">
        <div>
          <h2>{mobile ? "管理规则" : "让家在合适的时候响应"}</h2>
          {!mobile && <p>看清触发、条件与动作，再决定是否启用。</p>}
        </div>
        {canManage && (
          <Button
            disabled={busy || !state.devices.length || !state.scenes.length}
            icon={<Plus size={16} />}
            onClick={() => open()}
          >
            创建规则
          </Button>
        )}
      </div>
      <div className="flow-tabs">
        <button aria-pressed={tab === "rules"} onClick={() => setTab("rules")}>
          我的规则 · {state.automations.length}
        </button>
        <button aria-pressed={tab === "logs"} onClick={() => setTab("logs")}>
          执行记录
        </button>
      </div>
      {tab === "logs" ? (
        <History
          initialRunId={focusedRun}
          runs={state.automationRuns}
          render={(run) => {
            const sceneRun = state.sceneRuns.find(
              (r) => r.id === run.sceneRunId,
            );
            return (
              <>
                <h3>{run.name}</h3>
                <p className={"flow-status " + run.status}>
                  {runLabels[run.status]}
                  {run.reason ? " · " + run.reason : ""}
                </p>
                <ol className="rule-sentence">
                  <li>
                    <b>当</b>
                    <span>
                      {deviceName(state.devices, run.event.deviceId)}
                      <strong>
                        {capabilityLabels[run.event.capability]}：
                        {valueText(run.event.capability, run.event.from)} →{" "}
                        {valueText(run.event.capability, run.event.to)}
                      </strong>
                    </span>
                  </li>
                  <li>
                    <b>判定</b>
                    <span>
                      {new Date(run.evaluatedAt).toLocaleString("zh-CN")}
                      <small>规则版本 {run.ruleVersion}</small>
                    </span>
                  </li>
                  <li>
                    <b>结果</b>
                    <span>
                      {run.reason ?? "已调用场景"}
                      <small>{sceneRun?.name ?? run.sceneId}</small>
                    </span>
                  </li>
                </ol>
                {sceneRun ? (
                  <SceneResult run={sceneRun} devices={state.devices} />
                ) : (
                  <p className="flow-hint">
                    {run.sceneRunId
                      ? "关联场景记录已超出保留范围。"
                      : "本次未产生场景执行记录。"}
                  </p>
                )}
                {canManage &&
                  state.automations.some((r) => r.id === run.ruleId) && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        open(state.automations.find((r) => r.id === run.ruleId))
                      }
                    >
                      检查规则 / 预览
                    </Button>
                  )}
              </>
            );
          }}
        />
      ) : (
        <div className="flow-rule-cards">
          {(mobile
            ? [...state.automations].sort(
                (a, b) =>
                  Number(
                    state.automationRuns.find((r) => r.ruleId === b.id)
                      ?.status === "failed",
                  ) -
                  Number(
                    state.automationRuns.find((r) => r.ruleId === a.id)
                      ?.status === "failed",
                  ),
              )
            : state.automations
          ).map((rule) => {
            const last = state.automationRuns.find((r) => r.ruleId === rule.id);
            return (
              <article className="panel flow-rule-card" key={rule.id}>
                <div className="flow-heading">
                  <h3>
                    <Zap size={18} />
                    {rule.name}
                  </h3>
                  <Switch
                    checked={rule.enabled}
                    disabled={busy || !canManage}
                    aria-label={rule.name + "启用"}
                    onChange={(enabled) =>
                      void mutate("/automations/" + rule.id, "PATCH", {
                        enabled,
                      })
                    }
                  />
                </div>
                <Steps rule={rule} state={state} />
                {last && (
                  <button
                    className={"flow-last-run " + last.status}
                    onClick={() => {
                      setFocusedRun(last.id);
                      setTab("logs");
                    }}
                  >
                    {runLabels[last.status]}
                    {last.reason ? " · " + last.reason : ""} → 查看记录
                  </button>
                )}
                <div className="flow-card-buttons">
                  <small>冷却 {rule.executionPolicy.cooldownSeconds} 秒</small>
                  {canManage && (
                    <>
                      <Button disabled={busy} onClick={() => open(rule)}>
                        {mobile ? "预览 / 完整编辑" : "编辑与预览"}
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          confirmation.ask({
                            title: "删除自动化规则",
                            description: `删除“${rule.name}”？历史执行记录仍会保留。`,
                            confirmText: "删除规则",
                            danger: true,
                            action: () =>
                              mutate("/automations/" + rule.id, "DELETE", {}),
                          })
                        }
                      >
                        删除
                      </Button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
          {!state.automations.length && (
            <StatusPanel
              kind="empty"
              title="暂无自动化规则"
              description={
                canManage
                  ? "先创建场景，再选择触发设备和时间条件。"
                  : "家庭管理员创建规则后，可在这里查看。"
              }
              action={
                <a className="quiet-button" href="#scenes">
                  查看场景
                </a>
              }
            />
          )}
        </div>
      )}
      {confirmation.dialog}
    </div>
  );
}
