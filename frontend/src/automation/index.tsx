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
  return <><Tabs defaultActiveTab="rules">
    <Tabs.TabPane key="rules" title="我的自动化"><div className="two-col">
      <section className="panel"><h2>自动化规则</h2>
        {state.rules.map((rule) => <article className="rule" key={rule.id}>
          <div className="spread"><h3>{rule.name}</h3><Switch aria-label={rule.name} checked={rule.enabled} disabled={busy} onChange={(enabled) => void mutate('/rules/' + rule.id, 'PATCH', { enabled })} /></div>
          <dl>{[['触发', rule.trigger], ['条件', rule.condition], ['动作', rule.action]].map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
          <small className="muted">执行 {rule.runs} 次 · {rule.lastRun ? formatTime(rule.lastRun) : '暂无执行记录'}</small>
        </article>)}
      </section>
      <section className="panel"><h2>门锁指纹 · 专属欢迎语</h2><p className="muted">按成员配置播报内容，支持陌生指纹提醒。</p>
        {(Object.keys(members) as Member[]).map((key) => <label className="field-line" key={key}><span>{members[key]}</span><Input value={greetings[key]} maxLength={80} onChange={(value) => setGreetings({ ...greetings, [key]: value })} /></label>)}
        <p className="muted">播报设备 · {state.speaker}</p>
        <Checkbox checked={lightOn} onChange={setLightOn}>同时打开客厅灯</Checkbox>
        <div className="button-row"><Button disabled={busy} onClick={() => void save(false)}>保存配置</Button><Button type="primary" disabled={busy} onClick={() => void save(true)}>生成 / 更新联动</Button></div>
        <details><summary>设备要求</summary><p className="muted">需要门锁提供成员识别事件，音箱提供播报接口。当前示例使用模拟事件。</p></details>
      </section>
    </div></Tabs.TabPane>
    <Tabs.TabPane key="debug" title="调试实验室"><section className="panel"><h2>模拟播报</h2><p className="muted">使用已保存的欢迎语生成预览记录。</p>
      <div className="button-row"><Select aria-label="模拟成员" value={member} onChange={setMember} style={{ width: 180 }} options={Object.entries(members).map(([value, label]) => ({ value, label }))} />
        <Button type="primary" disabled={busy} onClick={() => void mutate('/simulations', 'POST', { member })}>模拟触发</Button></div>
      {state.events.length ? <ul className="records">{state.events.map((event) => <li key={event.id}><span>{event.message}</span><time>{formatTime(event.time)}</time></li>)}</ul> : <p className="empty">暂无播报记录</p>}
    </section></Tabs.TabPane>
  </Tabs></>;
}
