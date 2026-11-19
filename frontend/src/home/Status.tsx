import type { CSSProperties } from "react";
import {
  Activity,
  ArrowUpRight,
  BatteryLow,
  CircleAlert,
  WifiOff,
} from "lucide-react";
import type { State } from "../types";
import { attention, onlineSummary } from "../homeTelemetry";
import { isRunning } from "../devices";

export default function HomeStatus({
  state,
  live,
  canViewAutomation,
  onDevices,
  onOffline,
  onOpen,
}: {
  state: State;
  live: boolean;
  canViewAutomation: boolean;
  onDevices: () => void;
  onOffline: () => void;
  onOpen: (id: string) => void;
}) {
  const online = onlineSummary(state.devices);
  const issues = attention(state);
  const percent = online.total
    ? Math.round((online.online / online.total) * 100)
    : undefined;
  const running = state.devices.filter(isRunning).length;

  return (
    <section className="panel home-status" aria-label="家庭状态">
      <header className="home-panel-heading">
        <h2>
          <Activity size={19} aria-hidden />
          家庭状态
        </h2>
        <button className="home-text-action" onClick={onDevices}>
          全部设备 <ArrowUpRight size={15} aria-hidden />
        </button>
      </header>
      <div className="home-status-body">
        <div
          className="home-status-dial"
          style={{ "--online-progress": `${percent ?? 0}%` } as CSSProperties}
          role="img"
          aria-label={`设备在线率${percent === undefined ? "暂无数据" : percent + "%"}`}
        >
          <div>
            <strong>
              {percent ?? "—"}
              {percent !== undefined && <small>%</small>}
            </strong>
            <span>设备在线率</span>
          </div>
        </div>
        <dl className="home-status-metrics">
          <div>
            <dt>
              <Activity size={16} aria-hidden />
              运行中
            </dt>
            <dd>
              {running}
              <small>项</small>
            </dd>
          </div>
          <div>
            <dt>
              <WifiOff size={16} aria-hidden />
              离线设备
            </dt>
            <dd>
              <button
                onClick={onOffline}
                className={online.offline ? "has-warning" : ""}
                aria-label={`查看离线设备，${online.offline} 项`}
              >
                {online.offline}
                <small>项</small>
              </button>
            </dd>
          </div>
          <div>
            <dt title="在线设备已上报的电量低于 20%">
              <BatteryLow size={16} aria-hidden />
              低电量
            </dt>
            <dd className={issues.lowBattery.length ? "has-warning" : ""}>
              {issues.lowBattery.length}
              <small>项</small>
            </dd>
          </div>
        </dl>
      </div>
      <footer className="home-status-source">
        <span>
          {!live && "上次记录 · "}
          {online.total
            ? `${online.online} / ${online.total} 项设备在线`
            : "尚未发现设备"}
        </span>
        {online.simulated > 0 && <span>含 {online.simulated} 项模拟数据</span>}
      </footer>
      {(issues.lowBattery.length > 0 ||
        issues.scenes.length > 0 ||
        (canViewAutomation && issues.automations.length > 0)) && (
        <div className="home-status-failures">
          {issues.lowBattery.slice(0, 2).map((device) => (
            <button key={device.id} onClick={() => onOpen(device.id)}>
              <BatteryLow size={16} aria-hidden />
              <span>
                {device.name}
                <small>电量 {Math.round(device.state.values.battery!)}%</small>
              </span>
              <ArrowUpRight size={16} aria-hidden />
            </button>
          ))}
          {issues.scenes.length > 0 && (
            <a href="#scenes">
              <CircleAlert size={16} aria-hidden />
              <span>
                {issues.scenes.length} 个场景执行失败
                <small>{issues.scenes[0].name}</small>
              </span>
              <ArrowUpRight size={16} aria-hidden />
            </a>
          )}
          {canViewAutomation && issues.automations.length > 0 && (
            <a href="#automation">
              <CircleAlert size={16} aria-hidden />
              <span>
                {issues.automations.length} 条自动化执行失败
                <small>{issues.automations[0].name}</small>
              </span>
              <ArrowUpRight size={16} aria-hidden />
            </a>
          )}
        </div>
      )}
    </section>
  );
}
