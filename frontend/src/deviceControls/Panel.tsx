import RangeControl from "./RangeControl";
import { StatusPanel } from "../ui/StatusPanel";
import { useEffect, useRef, useState } from "react";
import { Drawer, Button } from "@arco-design/web-react";
import { Minus, Plus, Power, Star, WifiOff, X } from "lucide-react";
import type { DeviceSnapshot, DeviceCommand, Mutate } from "../types";
import { sourceLabel } from "../homeTelemetry";
import { deviceSummary, modeLabels, sendDeviceCommand } from "./model";
export default function DevicePanel({
  device,
  visible,
  mobile,
  busy,
  mutate,
  onClose,
}: {
  device?: DeviceSnapshot;
  visible: boolean;
  mobile: boolean;
  busy: boolean;
  mutate: Mutate;
  onClose: () => void;
}) {
  const lastDevice = useRef<DeviceSnapshot>();
  if (device) lastDevice.current = device;
  else if (!visible) device = lastDevice.current;
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);
  const operation = useRef(0);
  useEffect(() => {
    operation.current++;
    setFeedback("");
    setPending(false);
  }, [device?.id, visible]);
  const send = async (command: DeviceCommand) => {
    if (!device || busy || pending) return false;
    const version = operation.current;
    setPending(true);
    setFeedback("正在下发…");
    let ok = false;
    try {
      ok = await sendDeviceCommand(mutate, device, command);
    } catch {
      /* Preserve a local failure even if an unexpected caller rejects. */
    }
    if (version === operation.current) {
      setPending(false);
      setFeedback(
        ok
          ? "命令已下发，当前状态以实时反馈为准。"
          : "命令未下发，请检查连接或设备状态后重试。",
      );
    }
    return ok;
  };
  const disabled = busy || pending || !device?.state.online,
    v = device?.state.values ?? {},
    has = (cap: DeviceCommand["capability"]) =>
      device?.capabilities.includes(cap);
  return (
    <Drawer
      getPopupContainer={() => document.fullscreenElement ?? document.body}
      visible={visible}
      title={null}
      closable={false}
      bodyStyle={{
        maxHeight: "85dvh",
        overflow: "auto",
        paddingBottom: "calc(24px + env(safe-area-inset-bottom))",
      }}
      placement={mobile ? "bottom" : "right"}
      height={mobile ? "auto" : undefined}
      width={mobile ? undefined : 420}
      footer={null}
      className="device-control-drawer"
      onCancel={onClose}
      focusLock
      autoFocus
      unmountOnExit
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={device?.name ?? "设备详情"}
      >
        <div className="control-sheet-heading">
          <span>{device?.name ?? "设备详情"}</span>
          <button aria-label="关闭设备详情" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {!device ? (
          <StatusPanel
            compact
            kind="empty"
            title="暂未发现该设备"
            description="设备可能已移除，或正在等待重新发现。"
          />
        ) : (
          <div className="device-control-panel">
            <div className="control-meta">
              <span>
                {device.room} · {sourceLabel(device)}
              </span>

            </div>
            {!device.state.online && (
              <p className="control-offline" role="status">
                <WifiOff size={18} />
                设备离线，当前不能控制。
                {device.state.lastSeenAt
                  ? " 最后在线 " +
                    new Date(device.state.lastSeenAt).toLocaleString("zh-CN")
                  : ""}
              </p>
            )}
            <p className="control-state">{deviceSummary(device)}</p>
            {has("power") && (
              <Button
                long
                type={v.power ? "primary" : "secondary"}
                disabled={disabled || v.power === undefined}
                onClick={() =>
                  void send({ capability: "power", value: !v.power })
                }
                icon={<Power size={18} />}
              >
                {v.power ? "关闭设备" : "开启设备"}
              </Button>
            )}
            {has("brightness") && (
              <RangeControl
                key={device.id + "brightness"}
                label="亮度"
                unit="%"
                min={1}
                max={100}
                value={v.brightness}
                disabled={disabled}
                onSend={(value) => send({ capability: "brightness", value })}
              />
            )}
            {has("colorTemperature") && (
              <RangeControl
                label="色温"
                unit=" K"
                min={2000}
                max={6500}
                step={100}
                value={v.colorTemperature}
                disabled={disabled}
                onSend={(value) =>
                  send({ capability: "colorTemperature", value })
                }
              />
            )}
            {has("targetTemperature") && (
              <div className="control-temperature">
                <span>目标温度</span>
                <div>
                  <button
                    aria-label="降低目标温度"
                    disabled={disabled || v.targetTemperature === undefined}
                    onClick={() =>
                      void send({
                        capability: "targetTemperature",
                        value: v.targetTemperature! - 0.5,
                      })
                    }
                  >
                    <Minus />
                  </button>
                  <strong>
                    {v.targetTemperature ?? "—"}
                    <small>°C</small>
                  </strong>
                  <button
                    aria-label="提高目标温度"
                    disabled={disabled || v.targetTemperature === undefined}
                    onClick={() =>
                      void send({
                        capability: "targetTemperature",
                        value: v.targetTemperature! + 0.5,
                      })
                    }
                  >
                    <Plus />
                  </button>
                </div>
                <small>
                  当前温度{" "}
                  {v.temperature === undefined
                    ? "暂无数据"
                    : v.temperature + "°C"}
                </small>
              </div>
            )}
            {has("hvacMode") && (
              <label className="control-select">
                空调模式
                <select
                  value={v.hvacMode ?? ""}
                  disabled={disabled}
                  onChange={(e) =>
                    void send({
                      capability: "hvacMode",
                      value: e.target.value as NonNullable<typeof v.hvacMode>,
                    })
                  }
                >
                  {!v.hvacMode && <option value="">暂无数据</option>}
                  {Object.entries(modeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {has("positionPercent") && (
              <RangeControl
                label="窗帘打开比例"
                unit="%"
                min={0}
                max={100}
                value={v.positionPercent}
                disabled={disabled}
                onSend={(value) =>
                  send({ capability: "positionPercent", value })
                }
              />
            )}
            {has("position") && (
              <div className="control-actions">
                {(["open", "stop", "closed"] as const).map((value) => (
                  <Button
                    key={value}
                    disabled={disabled}
                    onClick={() => void send({ capability: "position", value })}
                  >
                    {{ open: "打开", stop: "停止", closed: "关闭" }[value]}
                  </Button>
                ))}
              </div>
            )}
            {has("cleaning") && (
              <Button
                long
                disabled={disabled || v.cleaning === undefined}
                onClick={() =>
                  void send({ capability: "cleaning", value: !v.cleaning })
                }
              >
                {v.cleaning ? "暂停清扫" : "开始清扫"}
              </Button>
            )}
            <dl className="control-readings">
              {(
                [
                  ["温度", v.temperature, "°C"],
                  ["湿度", v.humidity, "%"],
                  ["PM2.5", v.pm25, "μg/m³"],
                  ["CO₂", v.co2, "ppm"],
                  ["电量", v.battery, "%"],
                ] as const
              )
                .filter(([, value]) => value !== undefined)
                .map(([label, value, unit]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      {device.state.online ? `${value} ${unit}` : "暂无数据"}
                    </dd>
                  </div>
                ))}
              {v.occupancy !== undefined && (
                <div>
                  <dt>人体感应</dt>
                  <dd>
                    {device.state.online
                      ? v.occupancy
                        ? "检测到活动"
                        : "未检测到活动"
                      : "暂无数据"}
                  </dd>
                </div>
              )}
              {v.contact !== undefined && (
                <div>
                  <dt>门窗状态</dt>
                  <dd>
                    {device.state.online
                      ? v.contact === "open"
                        ? "打开"
                        : "关闭"
                      : "暂无数据"}
                  </dd>
                </div>
              )}
            </dl>
            {device.state.updatedAt && (
              <small>
                最近状态更新{" "}
                {new Date(device.state.updatedAt).toLocaleString("zh-CN")}
              </small>
            )}
            <details className="control-detail-meta">
              <summary>设备信息与能力</summary>
              <dl>
                <div>
                  <dt>房间</dt>
                  <dd>{device.room}</dd>
                </div>
                <div>
                  <dt>数据来源</dt>
                  <dd>{sourceLabel(device)}</dd>
                </div>
                <div>
                  <dt>设备标识</dt>
                  <dd>{device.id}</dd>
                </div>
                <div>
                  <dt>最后在线</dt>
                  <dd>
                    {device.state.lastSeenAt
                      ? new Date(device.state.lastSeenAt).toLocaleString(
                          "zh-CN",
                        )
                      : "暂无记录"}
                  </dd>
                </div>
                <div>
                  <dt>已声明能力</dt>
                  <dd className="capability-tags">
                    {device.capabilities.map((c) => (
                      <span key={c}>{c}</span>
                    ))}
                  </dd>
                </div>
              </dl>
            </details>
            {feedback && (
              <p className="control-feedback" role="status">
                {feedback}
              </p>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
