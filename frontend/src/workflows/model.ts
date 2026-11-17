import type { Capability, DeviceCommand, DeviceSnapshot } from "../types";
export const capabilityLabels: Record<Capability, string> = {
  power: "电源",
  brightness: "亮度",
  colorTemperature: "色温",
  position: "窗帘开合",
  positionPercent: "打开比例",
  cleaning: "清扫",
  battery: "电量",
  temperature: "温度",
  humidity: "湿度",
  binary: "触发状态",
  occupancy: "人体感应",
  contact: "门窗状态",
  pm25: "PM2.5",
  co2: "CO₂",
  targetTemperature: "目标温度",
  hvacMode: "空调模式",
};
export const writable = [
  "power",
  "brightness",
  "colorTemperature",
  "position",
  "positionPercent",
  "cleaning",
  "targetTemperature",
  "hvacMode",
] as const;
export type Scalar = boolean | number | string;
export const valueChoices: Partial<Record<Capability, [Scalar, string][]>> = {
  power: [
    [true, "开启"],
    [false, "关闭"],
  ],
  cleaning: [
    [true, "开始清扫"],
    [false, "暂停"],
  ],
  occupancy: [
    [true, "检测到活动"],
    [false, "无人活动"],
  ],
  binary: [
    [true, "已触发"],
    [false, "未触发"],
  ],
  contact: [
    ["open", "打开"],
    ["closed", "关闭"],
  ],
  position: [
    ["open", "打开"],
    ["stop", "停止"],
    ["closed", "关闭"],
  ],
  hvacMode: [
    ["off", "关闭"],
    ["cool", "制冷"],
    ["heat", "制热"],
    ["auto", "自动"],
    ["heat_cool", "冷暖"],
    ["dry", "除湿"],
    ["fan_only", "送风"],
  ],
};
export function initialValue(capability: Capability): Scalar {
  return (
    valueChoices[capability]?.[0][0] ??
    (
      {
        brightness: 50,
        colorTemperature: 3500,
        targetTemperature: 23,
      } as Partial<Record<Capability, number>>
    )[capability] ??
    0
  );
}
export function valueText(capability: Capability, value: Scalar | undefined) {
  if (value === undefined) return "未知";
  const choice = valueChoices[capability]?.find(([v]) => v === value);
  if (choice) return choice[1];
  const units: Partial<Record<Capability, string>> = {
    brightness: "%",
    positionPercent: "%",
    humidity: "%",
    battery: "%",
    colorTemperature: " K",
    temperature: "°C",
    targetTemperature: "°C",
    pm25: " μg/m³",
    co2: " ppm",
  };
  return String(value) + (units[capability] ?? "");
}
export function actionText(command: DeviceCommand) {
  return (
    capabilityLabels[command.capability] +
    " · " +
    valueText(command.capability, command.value)
  );
}
export function deviceName(devices: DeviceSnapshot[], id: string) {
  return devices.find((d) => d.id === id)?.name ?? "设备已移除（" + id + "）";
}
export function windowText(start: string, end: string) {
  return `${start} — ${start > end ? "次日 " : ""}${end}`;
}
export const runLabels = {
  running: "执行中",
  completed: "动作已下发",
  failed: "执行失败",
  skipped: "已跳过",
};
export function previewInstant(local: string) {
  if (!local) return undefined;
  const date = new Date(local);
  if (!Number.isFinite(date.getTime())) throw Error("预览时间无效");
  return date.toISOString();
}
