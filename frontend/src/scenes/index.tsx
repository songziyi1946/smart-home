import { StatusPanel } from "../ui/StatusPanel";
import { useConfirmAction } from "../ui/useConfirmAction";
import { useState } from "react";
import { Button } from "@arco-design/web-react";
import { Play, Plus, ArrowUp, ArrowDown, Trash2, Layers } from "lucide-react";
import type { State, Scene, Mutate, DeviceCommand } from "../types";
import { useMobile } from "../mobile/hooks";
import {
  writable,
  initialValue,
  capabilityLabels,
  actionText,
  deviceName,
  runLabels,
} from "../workflows/model";
import { History, SceneResult, ValueField } from "../workflows/Shared";
import "../workflows/style.css";
export default function Scenes({
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
    [draft, setDraft] = useState<Scene>(),
    [selected, setSelected] = useState<string>(),
    [error, setError] = useState(""),
    [focusedRun, setFocusedRun] = useState<string>(),
    [tab, setTab] = useState("scenes");
  const available = state.devices.filter((d) =>
    d.capabilities.some((c) =>
      writable.includes(c as (typeof writable)[number]),
    ),
  );
  const current =
    state.scenes.find((s) => s.id === selected) ?? state.scenes[0];
  const running = state.sceneRuns.some((r) => r.status === "running");
  const confirmDelete = (scene: Scene) => {
    const references = state.automations.filter(
      (rule) => rule.action.sceneId === scene.id,
    ).length;
    confirmation.ask({
      title: "删除场景",
      description:
        "删除“" +
        scene.name +
        "”？历史执行记录仍会保留。" +
        (references
          ? "有 " +
            references +
            " 条自动化规则引用此场景，删除后这些规则将无法执行。"
          : ""),
      confirmText: "删除场景",
      danger: true,
      action: () => mutate("/scenes/" + scene.id, "DELETE", {}),
    });
  };
  const initialAction = (id = available[0]?.id) => {
    const d = available.find((d) => d.id === id),
      c = d?.capabilities.find((c) =>
        writable.includes(c as (typeof writable)[number]),
      );
    return d && c
      ? {
          deviceId: d.id,
          command: { capability: c, value: initialValue(c) } as DeviceCommand,
        }
      : undefined;
  };
  const edit = (scene?: Scene) => {
    setError("");
    setDraft(
      scene
        ? structuredClone(scene)
        : {
            id: "",
            name: "",
            description: "",
            version: 0,
            actions: [initialAction()!],
          },
    );
  };
  const change = (i: number, patch: Partial<Scene["actions"][number]>) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            actions: d.actions.map((a, index) =>
              index === i ? { ...a, ...patch } : a,
            ),
          }
        : d,
    );
  const move = (i: number, offset: number) => {
    if (!draft) return;
    const actions = [...draft.actions];
    [actions[i], actions[i + offset]] = [actions[i + offset], actions[i]];
    setDraft({ ...draft, actions });
  };
  const execute = (scene: Scene) =>
    void mutate("/scenes/" + scene.id, "POST", {});
  if (draft)
    return (
      <section className="panel flow-editor">
        <div className="flow-heading">
          <div>
            <h2>{draft.id ? "编辑场景" : "创建场景"}</h2>
          </div>
          <Button disabled={pending} onClick={() => setDraft(undefined)}>
            返回场景
          </Button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            const { id, version, ...input } = draft;
            if (
              await mutate(
                "/scenes" + (id ? "/" + id : ""),
                id ? "PUT" : "POST",
                { ...input, ...(id ? { version } : {}) },
              )
            )
              setDraft(undefined);
            else
              setError(
                "保存未完成，请查看页面提示；若版本冲突，请重新打开场景。",
              );
          }}
        >
          <fieldset disabled={busy || !canManage}>
            <div className="flow-form-pair">
              <label className="flow-field">
                场景名称
                <input
                  required
                  maxLength={80}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label className="flow-field">
                说明
                <input
                  maxLength={200}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                />
              </label>
            </div>
            <h3 title="按顺序下发。遇到失败即停止，已执行的动作不会自动回滚。">
              动作 · {draft.actions.length}
            </h3>
            {draft.actions.map((a, i) => {
              const d = state.devices.find((d) => d.id === a.deviceId);
              return (
                <section
                  className="flow-action"
                  key={i}
                  aria-label={"动作 " + (i + 1)}
                >
                  <header>
                    <span className="flow-step-number">{i + 1}</span>
                    <strong>{deviceName(state.devices, a.deviceId)}</strong>
                    <div>
                      <button
                        type="button"
                        aria-label={`动作${i + 1}上移`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        type="button"
                        aria-label={`动作${i + 1}下移`}
                        disabled={i === draft.actions.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown size={16} />
                      </button>
                      <button
                        type="button"
                        aria-label={`移除动作${i + 1}`}
                        disabled={draft.actions.length === 1}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            actions: draft.actions.filter(
                              (_, index) => index !== i,
                            ),
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </header>
                  <div className="flow-action-fields">
                    <label className="flow-field">
                      设备
                      <select
                        value={a.deviceId}
                        onChange={(e) =>
                          change(i, initialAction(e.target.value)!)
                        }
                      >
                        {!d && <option value={a.deviceId}>设备已移除</option>}
                        {available.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {item.room}
                            {item.state.online ? "" : "（离线）"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flow-field">
                      控制能力
                      <select
                        value={a.command.capability}
                        onChange={(e) => {
                          const capability = e.target
                            .value as DeviceCommand["capability"];
                          change(i, {
                            command: {
                              capability,
                              value: initialValue(capability),
                            } as DeviceCommand,
                          });
                        }}
                      >
                        {[
                          ...new Set([
                            a.command.capability,
                            ...(d?.capabilities.filter((c) =>
                              writable.includes(c as (typeof writable)[number]),
                            ) ?? []),
                          ]),
                        ].map((c) => (
                          <option key={c} value={c}>
                            {capabilityLabels[c]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <ValueField
                      label="设置为"
                      capability={a.command.capability}
                      value={a.command.value}
                      onChange={(value) =>
                        change(i, {
                          command: {
                            ...a.command,
                            value: value ?? "",
                          } as DeviceCommand,
                        })
                      }
                    />
                  </div>
                  {!d?.state.online && (
                    <p className="flow-failure">
                      设备离线或已移除，执行时可能失败。
                    </p>
                  )}
                </section>
              );
            })}
            <Button
              disabled={draft.actions.length >= 100 || !available.length}
              onClick={() => {
                const a = initialAction();
                if (a) setDraft({ ...draft, actions: [...draft.actions, a] });
              }}
              icon={<Plus size={16} />}
            >
              添加动作
            </Button>
            <div className="flow-save">
              <span>
                {error && (
                  <span role="alert" className="flow-failure">
                    {error}
                  </span>
                )}
              </span>
              <Button htmlType="submit" type="primary" loading={pending}>
                保存场景
              </Button>
            </div>
          </fieldset>
        </form>
      </section>
    );
  return (
    <div className={"flow-page " + (mobile ? "flow-mobile" : "")}>
      <div className="flow-toolbar">
        <div className="flow-tabs">
          <button
            aria-pressed={tab === "scenes"}
            onClick={() => setTab("scenes")}
          >
            场景列表
          </button>
          <button aria-pressed={tab === "logs"} onClick={() => setTab("logs")}>
            执行记录
            {state.sceneRuns.some((r) => r.status === "failed")
              ? " · 含失败记录"
              : ""}
          </button>
        </div>
        {canManage && (
          <Button
            disabled={busy || !available.length}
            icon={<Plus size={16} />}
            onClick={() => edit()}
          >
            创建场景
          </Button>
        )}
      </div>
      {tab === "logs" ? (
        <History
          initialRunId={focusedRun}
          runs={state.sceneRuns}
          render={(run) => (
            <>
              <h3>{run.name}</h3>
              <SceneResult run={run} devices={state.devices} />
              {run.status === "failed" &&
                state.scenes.some((s) => s.id === run.sceneId) && (
                  <Button
                    disabled={busy || running}
                    onClick={() =>
                      confirmation.ask({
                        title: "重新执行场景",
                        description:
                          "将按当前编排重新下发整个场景的所有动作；已执行动作不会回滚。",
                        confirmText: "重新执行",
                        action: () =>
                          mutate("/scenes/" + run.sceneId, "POST", {}),
                      })
                    }
                  >
                    重新执行整个场景
                  </Button>
                )}
            </>
          )}
        />
      ) : (
        <div className="flow-scene-layout">
          <div className="flow-scene-cards">
            {(mobile
              ? [...state.scenes].sort(
                  (a, b) =>
                    Number(
                      state.sceneRuns.find((r) => r.sceneId === b.id)
                        ?.status === "failed",
                    ) -
                    Number(
                      state.sceneRuns.find((r) => r.sceneId === a.id)
                        ?.status === "failed",
                    ),
                )
              : state.scenes
            ).map((scene) => {
              const last = state.sceneRuns.find((r) => r.sceneId === scene.id);
              return (
                <article
                  className={
                    "panel flow-scene-card" +
                    ((mobile ? selected : current?.id) === scene.id
                      ? " selected"
                      : "")
                  }
                  key={scene.id}
                >
                  <div className="flow-heading">
                    <Layers size={22} />
                    <small>{scene.actions.length} 个动作</small>
                  </div>
                  <button
                    className="flow-scene-name"
                    onClick={() => setSelected(scene.id)}
                  >
                    <h3>{scene.name}</h3>
                    <p>
                      {scene.description ||
                        scene.actions
                          .slice(0, 2)
                          .map((a) => deviceName(state.devices, a.deviceId))
                          .join("、")}
                    </p>
                  </button>
                  {last && (
                    <button
                      className={"flow-last-run " + last.status}
                      onClick={() => {
                        setFocusedRun(last.id);
                        setTab("logs");
                      }}
                    >
                      最近：{runLabels[last.status]}
                      {last.reason ? " · " + last.reason : ""}
                    </button>
                  )}
                  <div className="flow-card-buttons">
                    <Button
                      type="primary"
                      disabled={busy || running}
                      icon={<Play size={15} />}
                      onClick={() => execute(scene)}
                    >
                      执行
                    </Button>
                    <Button onClick={() => setSelected(scene.id)}>
                      查看动作
                    </Button>
                    {canManage && mobile && (
                      <Button disabled={busy} onClick={() => edit(scene)}>
                        编辑
                      </Button>
                    )}
                  </div>
                  {mobile && selected === scene.id && (
                    <ol className="flow-mobile-actions">
                      {scene.actions.map((a, i) => (
                        <li key={i}>
                          {deviceName(state.devices, a.deviceId)} ·{" "}
                          {actionText(a.command)}
                        </li>
                      ))}
                    </ol>
                  )}
                </article>
              );
            })}
            {!state.scenes.length && (
              <StatusPanel
                kind="empty"
                title="暂无场景"
                description={
                  canManage
                    ? available.length
                      ? "创建场景，把多个设备动作组合为一次执行。"
                      : "先接入支持控制的设备，再创建场景。"
                    : "家庭管理员创建场景后，可在这里执行。"
                }
              />
            )}
          </div>
          {!mobile && current && (
            <section className="panel flow-scene-inspector">
              <div className="flow-heading">
                <h2>{current.name}</h2>
                {canManage && (
                  <Button disabled={busy} onClick={() => edit(current)}>
                    编辑编排
                  </Button>
                )}
              </div>
              <ol className="flow-timeline">
                {current.actions.map((a, i) => (
                  <li key={i}>
                    <span className="flow-step-number">{i + 1}</span>
                    <div>
                      <strong>{deviceName(state.devices, a.deviceId)}</strong>
                      <p>{actionText(a.command)}</p>
                      {!state.devices.find((d) => d.id === a.deviceId)?.state
                        .online && (
                        <small className="flow-failure">设备离线或已移除</small>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {canManage && (
                <Button
                  status="danger"
                  disabled={busy}
                  onClick={() => confirmDelete(current)}
                >
                  删除场景
                </Button>
              )}
            </section>
          )}
          {mobile && canManage && current && selected === current.id && (
            <Button
              status="danger"
              disabled={busy}
              onClick={() => confirmDelete(current)}
            >
              删除所选场景
            </Button>
          )}
        </div>
      )}
      {confirmation.dialog}
    </div>
  );
}
