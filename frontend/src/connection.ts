export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'error';
export function connectionMessage(status: ConnectionStatus, hasState: boolean) {
  const label = {connecting:'正在连接家庭',live:'实时连接',reconnecting:'正在重新连接',offline:'网络已离线',error:'暂时无法同步'}[status];
  const detail = status === 'live' ? '设备状态通过实时连接更新' : hasState ? '当前显示上次同步的数据，连接恢复前暂停控制。' : '等待家庭状态同步，连接恢复后会自动加载。';
  return {label,detail};
}
