import type { DeviceSnapshot, User } from "../types";
import type { MijiaRoom, MijiaStatus } from '../../../packages/contracts/mijia';
import design from '../vr/design-model.json';
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
  const mijia = devices.filter((d) => d.providerId === 'mijia');
  return {
    ha: ha.length,
    haOnline: ha.filter((d) => d.state.online).length,
    mock: devices.filter((d) => d.providerId === "mock").length,
    simulator: devices.filter((d) => d.state.source === "simulator").length,
    mijia: mijia.length,
    mijiaOnline: mijia.filter(device => device.state.online).length,
  };
}
export const modelRoomOptions = design.rooms.map(({ id, name }) => ({ id, name }));
export const mijiaStateLabels: Record<MijiaStatus['state'], string> = {
  unbound: '尚未绑定米家账号', authorizing: '等待完成账号验证', choose_home: '登录成功，请选择家庭',
  connected: '米家连接正常', offline: '暂时无法同步米家设备', reauth_required: '米家登录已失效，请重新登录',
};
export function captchaImageSource(image?: string) {
  return image && image.length <= 1_500_000 && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(image) ? image : undefined;
}
export function roomBindingPayload(rooms: MijiaRoom[], selected: Record<string, string>) {
  return rooms.flatMap(room => {
    const id = selected[room.id];
    if (!id) return [];
    const target = modelRoomOptions.find(option => option.id === id);
    if (!target && room.mappedRoomId !== id) return [];
    return [{ providerRoomId: room.id, roomId: id, roomName: target?.name ?? room.mappedRoomName ?? room.name }];
  });
}
export function guestAccessText(hours: number) {
  return hours === 168 ? "加入后 7 天" : `加入后 ${hours} 小时`;
}
