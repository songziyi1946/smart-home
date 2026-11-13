import { useState } from 'react';
import { Button, Switch, Modal, Slider } from '@arco-design/web-react';
import { Lightbulb, AirVent, ScanLine, Bot, ChevronRight } from 'lucide-react';
import type { Device, Mutate } from '../types';

export default function DeviceRow({ device, busy, mutate }: { device: Device; busy: boolean; mutate: Mutate }) {
  const [details, setDetails] = useState(false);
  const send = (action: string, value: string | boolean | number) => mutate('/devices/' + device.id, 'PATCH', { action, value });
  const Icon = device.kind === 'light' ? Lightbulb : device.kind === 'ac' ? AirVent : device.kind === 'curtain' ? ScanLine : Bot;
  const active = 'on' in device ? device.on : device.kind === 'curtain' ? device.position === 'open' : device.cleaning;
  const status = device.kind === 'light' ? (device.on ? '已开 · ' + device.level + '%' : '已关') :
    device.kind === 'ac' ? (device.on ? '已开' : '已关') :
    device.kind === 'robot' ? (device.cleaning ? '清扫中' : '待机') + ' · 电量 ' + device.battery + '%' :
    { open: '已打开', closed: '已关闭', stop: '已停止' }[device.position];
  return <div className={'device' + (active ? ' device-active' : '')}>
    <div className="device-line">
      <span className={'device-art kind-' + device.kind}><Icon size={25} /></span>
      <div className="device-label">{device.kind === 'light' ?
        <button aria-expanded={details} onClick={() => setDetails(!details)}>{device.name} <ChevronRight size={13} /></button> :
        <strong>{device.name}</strong>}<small className="device-location">{device.room}</small><small className="device-status">{status}</small></div>
      {(device.kind === 'light' || device.kind === 'ac') && <Switch aria-label={device.name} checked={device.on} disabled={busy} onChange={(value) => void send('power', value)} />}
      {device.kind === 'robot' && <Button size="small" disabled={busy} onClick={() => void send('clean', !device.cleaning)}>{device.cleaning ? '暂停' : '开始清扫'}</Button>}
    </div>
    {device.kind === 'curtain' && <div className="button-row">
      {([{ value: 'open', label: '打开' }, { value: 'stop', label: '停止' }, { value: 'closed', label: '关闭' }]).map(({ value, label }) =>
        <Button key={value} size="small" disabled={busy || device.position === value} onClick={() => void send('position', value)}>{label}</Button>)}
    </div>}
    {device.kind === 'light' && <Modal visible={details} title={device.name + ' · 亮度调节'} footer={null} onCancel={() => setDetails(false)}><div className="brightness">
      <small>亮度 {device.level}%</small><Slider aria-label={device.name + '亮度'} min={1} max={100} defaultValue={device.level} disabled={busy} onAfterChange={(value) => { if (typeof value === 'number') void send('level', value); }} />
    </div></Modal>}
  </div>;
}
