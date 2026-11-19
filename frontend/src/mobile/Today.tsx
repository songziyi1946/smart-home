import { useState } from "react";
import {
  ArrowUpRight,
  BatteryLow,
  CircleAlert,
  Droplets,
  House,
  Mic,
  Sparkles,
  Thermometer,
} from "lucide-react";
import type { State, Mutate } from "../types";
import {
  attention,
  metricReading,
  occupancyReading,
  onlineSummary,
} from "../homeTelemetry";
import VoiceEntry from "./VoiceEntry";

export default function Today({
  state,
  live,
  busy,
  canViewAutomation,
  mutate,
  onRoom,
  onOffline,
  onOpen,
}: {
  state: State;
  live: boolean;
  busy: boolean;
  canViewAutomation: boolean;
  mutate: Mutate;
  onRoom: (id: string) => void;
  onOffline: () => void;
  onOpen: (id: string) => void;
}) {
  const [weekend, setWeekend] = useState(() =>
    [0, 6].includes(new Date().getDay()),
  );
  const [voice, setVoice] = useState("");
  const [draft, setDraft] = useState("");
  const issues = attention(state);
  const occupancy = occupancyReading(state.devices);
  const online = onlineSummary(state.devices);
  const anchor =
    metricReading(state.devices, "temperature") ??
    metricReading(state.devices, "humidity");
  const roomDevices = anchor
    ? state.devices.filter((device) => device.roomId === anchor.device.roomId)
    : [];
  const temperature = metricReading(roomDevices, "temperature");
  const humidity = metricReading(roomDevices, "humidity");
  const primary =
    state.scenes.find((scene) => scene.id === (weekend ? "away" : "home")) ??
    state.scenes[0];
  const others = state.scenes
    .filter((scene) => scene.id !== primary?.id)
    .slice(0, 2);
  const running = state.sceneRuns.some((run) => run.status === "running");
  const agenda = weekend
    ? [
        ["09:30", "窗帘缓慢打开"],
        ["最后一人离家后", "开始清扫"],
        ["22:30", "睡前提醒"],
      ]
    : [
        ["18:00", "客厅调至 25°C"],
        ["到家后", "玄关灯亮起"],
        ["23:00", "睡前提醒"],
      ];
  return (
    <div className="mobile-today">
      <div className="today-context" aria-label="演示情境">
        <span>情境演示</span>
        <button aria-pressed={!weekend} onClick={() => setWeekend(false)}>
          工作日
        </button>
        <button aria-pressed={weekend} onClick={() => setWeekend(true)}>
          周末
        </button>
      </div>
      <section className="panel today-state" aria-label="家里现在">
        <small>{live ? "家里现在" : "上次同步的家庭状态"}</small>
        <h2>
          {occupancy.source === "暂无数据"
            ? "暂未接入在家感应"
            : occupancy.text}
        </h2>
        <p className="today-state-source">
          {occupancy.source !== "暂无数据" && occupancy.source + " · "}
          {online.total
            ? `${online.online} / ${online.total} 项设备在线`
            : "尚未发现设备"}
          {online.simulated > 0 && ` · 含 ${online.simulated} 项模拟数据`}
        </p>
        <div className="today-readings">
          <div>
            <Thermometer size={18} />
            <span>
              <small>{anchor ? anchor.device.room + "温度" : "温度"}</small>
              <strong>
                {temperature ? temperature.value + "°C" : "暂无数据"}
              </strong>
              {temperature && <small>{temperature.source}</small>}
            </span>
          </div>
          <div>
            <Droplets size={18} />
            <span>
              <small>湿度</small>
              <strong>{humidity ? humidity.value + "%" : "暂无数据"}</strong>
              {humidity && <small>{humidity.source}</small>}
            </span>
          </div>
        </div>
        {issues.offline.length > 0 && (
          <button className="today-warning" onClick={onOffline}>
            <CircleAlert size={18} />
            <span>{issues.offline.length} 项设备离线</span>
            <ArrowUpRight size={16} />
          </button>
        )}
        {issues.lowBattery.slice(0, 2).map((device) => (
          <button
            key={device.id}
            className="today-warning"
            onClick={() => onOpen(device.id)}
          >
            <BatteryLow size={18} />
            <span>
              {device.name} · 电量 {device.state.values.battery}%
            </span>
            <ArrowUpRight size={16} />
          </button>
        ))}
        {issues.scenes.length > 0 && (
          <a className="today-warning" href="#scenes">
            <CircleAlert size={18} />
            <span>{issues.scenes.length} 个场景执行失败</span>
            <ArrowUpRight size={16} />
          </a>
        )}
        {canViewAutomation && issues.automations.length > 0 && (
          <a className="today-warning" href="#automation">
            <CircleAlert size={18} />
            <span>{issues.automations.length} 条自动化执行失败</span>
            <ArrowUpRight size={16} />
          </a>
        )}
      </section>
      <section aria-label="现在常用">
        <header className="today-heading">
          <h2>现在常用</h2>
          <a href="#scenes">
            全部场景 <ArrowUpRight size={14} />
          </a>
        </header>
        {primary ? (
          <>
            <button
              className="today-primary"
              disabled={busy || running}
              onClick={() => void mutate("/scenes/" + primary.id, "POST", {})}
            >
              <House size={24} />
              <span>
                <strong>{primary.name}</strong>
                <small>
                  {state.sceneRuns.some(
                    (run) =>
                      run.sceneId === primary.id && run.status === "running",
                  )
                    ? "执行中…"
                    : primary.description || primary.actions.length + " 个动作"}
                </small>
              </span>
              <ArrowUpRight size={19} />
            </button>
            <div className="today-secondary">
              {others.map((scene) => (
                <button
                  key={scene.id}
                  disabled={busy || running}
                  onClick={() => void mutate("/scenes/" + scene.id, "POST", {})}
                >
                  {scene.name}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="today-empty">暂无场景，请先在场景页创建。</p>
        )}
        <button
          className="today-voice-entry"
          onClick={() => setVoice("语音说出今天的安排")}
        >
          <Mic size={18} />
          <span>
            说说今天的安排<small>例如“今天晚回” · 演示草稿</small>
          </span>
          <ArrowUpRight size={16} />
        </button>
      </section>
      <section aria-label="今日安排演示">
        <header className="today-heading">
          <h2>
            今日安排 <small className="today-demo-badge">演示</small>
          </h2>
          <button onClick={() => setVoice("语音调整安排")}>
            <Mic size={16} />
            语音调整
          </button>
        </header>
        <div className="panel today-agenda">
          <ol>
            {agenda.map(([time, title]) => (
              <li key={time}>
                <span className="today-agenda-dot" />
                <span>{time}</span>
                <strong>{title}</strong>
              </li>
            ))}
          </ol>
          <p className="today-demo-note">示例安排，尚未启用自动执行。</p>
        </div>
      </section>
      <section className="panel today-learning" aria-label="习惯建议演示">
        <Sparkles size={20} />
        <div>
          <h2>
            习惯建议 <small className="today-demo-badge">演示</small>
          </h2>
          <p>{weekend ? "周末想晚一点开窗帘？" : "回家后想用怎样的灯光？"}</p>
          <small>习惯学习尚未接入</small>
        </div>
        <button
          aria-label="语音录入习惯偏好"
          onClick={() => setVoice("语音录入习惯偏好")}
        >
          <Mic size={20} />
        </button>
      </section>
      {draft && (
        <section className="panel today-draft" role="status">
          <h2>演示草稿</h2>
          <p>{draft}</p>
          <small>本次首页暂存 · 尚未应用</small>
          <button onClick={() => setDraft("")}>清除草稿</button>
        </section>
      )}
      <button className="today-room-link" onClick={() => onRoom("all")}>
        查看房间与设备 <ArrowUpRight size={17} />
      </button>
      {voice && (
        <VoiceEntry
          purpose={voice}
          onClose={() => setVoice("")}
          onDraft={setDraft}
        />
      )}
    </div>
  );
}
