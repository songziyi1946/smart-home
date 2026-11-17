import type { DeviceSnapshot, User } from "../types";
export const roleNames = {
  admin: "家庭管理员",
  member: "家庭成员",
  guest: "限时访客",
};
export const roleDetails: Record<User["role"], string> = {
  admin: "管理成员、邀请、场景与自动化；使用设备、缴费和家庭功能。",
  member: "控制设备、执行场景、查看自动化及记账；不能管理成员或修改自动化。",
  guest: "仅可控制设备和执行场景；不可查看成员、自动化与缴费数据。",
};
export const permissionRows = [
  {
    name: "设备控制 / 场景执行",
    admin: "可用",
    member: "可用",
    guest: "有效期内可用",
  },
  {
    name: "场景编排 / 自动化管理",
    admin: "可用",
    member: "不可管理",
    guest: "不可管理",
  },
  {
    name: "自动化与其执行记录",
    admin: "可查看",
    member: "可查看",
    guest: "不可查看",
  },
  {
    name: "费用与缴费账户",
    admin: "可查看、添加",
    member: "可查看、添加",
    guest: "不可查看",
  },
  {
    name: "成员与邀请管理",
    admin: "可用",
    member: "不可查看名单",
    guest: "不可查看名单",
  },
] as const;
export function integrationSummary(devices: DeviceSnapshot[]) {
  const ha = devices.filter((d) => d.providerId === "home-assistant");
  return {
    ha: ha.length,
    haOnline: ha.filter((d) => d.state.online).length,
    mock: devices.filter((d) => d.providerId === "mock").length,
    simulator: devices.filter((d) => d.state.source === "simulator").length,
  };
}
export function guestAccessText(hours: number) {
  return hours === 168 ? "加入后 7 天" : `加入后 ${hours} 小时`;
}
