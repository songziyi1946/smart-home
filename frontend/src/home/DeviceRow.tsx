import { sourceLabel } from '../homeTelemetry';
import { useState } from 'react';
import { Button, Switch, Modal, Slider } from '@arco-design/web-react';
import { Lightbulb, AirVent, ScanLine, Bot, ChevronRight } from 'lucide-react';
import type { DeviceSnapshot, DeviceCommand, Mutate } from '../types';
import { hasCapability, isRunning } from '../devices';

export default function DeviceRow({ device, busy, mutate }: { device: DeviceSnapshot; busy: boolean; mutate: Mutate }) {
  const [details, setDetails] = useState(false);
  const send = (command: DeviceCommand) => mutate('/devices/' + device.id, 'PATCH', command);
  const brightness = hasCapability(device, 'brightness');
  const power = hasCapability(device, 'power');
  const position = hasCapability(device, 'position');
  const cleaning = hasCapability(device, 'cleaning');
  const values = device.state.values;
  const disabled = busy || !device.state.online;
  const Icon = brightness ? Lightbulb : power ? AirVent : position ? ScanLine : Bot;
  const active = device.state.online && (isRunning(device) || values.position === 'open');
  const statuses = [
    power ? values.power === undefined ? '状态未知' : values.power ? '已开' + (brightness && values.brightness !== undefined ? ' · ' + values.brightness + '%' : '') : '已关' : '',
    cleaning ? (values.cleaning === undefined ? '状态未知' : values.cleaning ? '清扫中' : '待机') + (hasCapability(device, 'battery') && values.battery !== undefined ? ' · 电量 ' + values.battery + '%' : '') : '',
    position ? values.position === undefined ? '状态未知' : { open: '已打开', closed: '已关闭', stop: '已停止' }[values.position] : '',
  ].filter(Boolean);
  const status = !device.state.online ? '已离线' : statuses.join(' · ') || '暂无可用控制';
  return <div className={'device' + (active ? ' device-active' : '') + (!device.state.online ? ' device-offline' : '')}>
    <div className="device-line">
      <span className={'device-art' + (brightness ? ' kind-light' : '')}><Icon size={25} /></span>
      <div className="device-label">{brightness ?
        <button aria-expanded={details} onClick={() => setDetails(!details)}>{device.name} <ChevronRight size={13} /></button> :
        <strong>{device.name}</strong>}<small className="device-location">{device.room} · {sourceLabel(device)}</small><small className="device-status">{status}</small></div>
      {power && <Switch aria-label={device.name} checked={values.power ?? false} disabled={disabled || values.power === undefined} onChange={(value) => void send({ capability: 'power', value })} />}
      {cleaning && <Button size="small" disabled={disabled || values.cleaning === undefined} onClick={() => void send({ capability: 'cleaning', value: !values.cleaning })}>{values.cleaning ? '暂停' : '开始清扫'}</Button>}
    </div>
    {position && <div className="button-row">
      {([{ value: 'open', label: '打开' }, { value: 'stop', label: '停止' }, { value: 'closed', label: '关闭' }] as const).map(({ value, label }) =>
        <Button key={value} size="small" disabled={disabled || values.position === value} onClick={() => void send({ capability: 'position', value })}>{label}</Button>)}
    </div>}
    {brightness && <Modal visible={details} title={device.name + ' · 亮度调节'} footer={null} getPopupContainer={() => document.fullscreenElement ?? document.body} onCancel={() => setDetails(false)}><div className="brightness">
      <small>亮度 {values.brightness ?? '—'}%</small><Slider aria-label={device.name + '亮度'} min={1} max={100} defaultValue={values.brightness} disabled={disabled || values.brightness === undefined} onAfterChange={(value) => { if (typeof value === 'number') void send({ capability: 'brightness', value }); }} />
    </div></Modal>}
  </div>;
}
