import Rules from './Rules';
import { useState } from 'react';
import { Button, Checkbox, Input, Select, Switch, Tabs } from '@arco-design/web-react';
import { members } from '../constants';
import type { Member } from '../constants';
import type { State, Mutate } from '../types';
import { formatTime } from '../utils';

export default function Automation({ state, busy, mutate }: { state: State; busy: boolean; mutate: Mutate }) {
  const [greetings, setGreetings] = useState(state.greetings);
  const [lightOn, setLightOn] = useState(state.lightOn);
  const [member, setMember] = useState<Member>('self');
  const save = (generate: boolean) => mutate('/greetings', 'PUT', { greetings, lightOn, speaker: state.speaker, generate });
  return <div className="automation-page"><Tabs defaultActiveTab="rules">
    <Tabs.TabPane key="rules" title="我的自动化"><div className="two-col">
      <Rules state={state} busy={busy} mutate={mutate}/>
      <section className="panel"><h2>门锁指纹 · 专属欢迎语</h2>
        {(Object.keys(members) as Member[]).map((key) => <label className="field-line" key={key}><span>{members[key]}</span><Input value={greetings[key]} maxLength={80} onChange={(value) => setGreetings({ ...greetings, [key]: value })} /></label>)}
        <p className="muted">播报设备 · {state.speaker}</p>
        <Checkbox checked={lightOn} onChange={setLightOn}>同时打开客厅灯</Checkbox>
        <div className="button-row"><Button disabled={busy} onClick={() => void save(false)}>保存配置</Button><small>欢迎语为原有播报模拟配置，不会创建可执行规则。</small></div>
      </section>
    </div></Tabs.TabPane>
    <Tabs.TabPane key="debug" title="调试实验室"><section className="panel"><h2>模拟播报</h2>
      <div className="button-row"><Select aria-label="模拟成员" value={member} onChange={setMember} style={{ width: 180 }} options={Object.entries(members).map(([value, label]) => ({ value, label }))} />
        <Button type="primary" disabled={busy} onClick={() => void mutate('/simulations', 'POST', { member })}>模拟触发</Button></div>
      {state.events.length ? <ul className="records">{state.events.map((event) => <li key={event.id}><span>{event.message}</span><time>{formatTime(event.time)}</time></li>)}</ul> : <p className="empty">暂无播报记录</p>}
    </section></Tabs.TabPane>
  </Tabs></div>;
}
