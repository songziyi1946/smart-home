import { useState } from 'react';
import { Button, Input, InputNumber, Modal, Select } from '@arco-design/web-react';
import { Zap, Droplets, Flame, Smartphone, ArrowUpRight, ReceiptText, MapPin } from 'lucide-react';
import { categories } from '../constants';
import type { Category } from '../constants';
import type { State, Mutate } from '../types';
import { localDate } from '../utils';

const channels = [
  { name: '网上国网', href: 'https://www.95598.cn/', icon: Zap },
  { name: '杭州水务', href: 'http://www.hzwgc.com/', icon: Droplets },
  { name: '杭州天然气', href: 'https://www.hzng.cn/', icon: Flame },
  { name: '中国移动', href: 'https://www.10086.cn/', icon: Smartphone },
  { name: '中国联通', href: 'https://www.10010.com/', icon: Smartphone },
  { name: '中国电信', href: 'https://www.189.cn/', icon: Smartphone },
];
const money = (cents: number) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100);

export default function Billing({ state, busy, mutate }: { state: State; busy: boolean; mutate: Mutate }) {
  const [dialog, setDialog] = useState<'account' | 'expense'>();
  const [category, setCategory] = useState<Category>('电费');
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [amount, setAmount] = useState<number>();
  const [date, setDate] = useState(localDate);
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const month = localDate().slice(0, 7);
  const monthly = state.expenses.filter((expense) => expense.date.startsWith(month)).reduce((sum, expense) => sum + expense.cents, 0);
  const months = Array.from({ length: 6 }, (_, index) => {
    const today = new Date();
    const key = localDate(new Date(today.getFullYear(), today.getMonth() - 5 + index, 1)).slice(0, 7);
    return { key, cents: state.expenses.filter(({ date }) => date.startsWith(key)).reduce((sum, item) => sum + item.cents, 0) };
  });
  const max = Math.max(1, ...months.map(({ cents }) => cents));
  function open(kind: 'account' | 'expense') {
    setCategory('电费'); setName(''); setNumber(''); setAmount(undefined); setDate(localDate()); setNote(''); setFormError(''); setDialog(kind);
  }
  async function submit() {
    const cents = Math.round((amount ?? 0) * 100);
    const account = dialog === 'account';
    if (account ? !name.trim() || !/^[\dA-Za-z-]{4,32}$/.test(number.trim()) : cents < 1 || !date) {
      setFormError(account ? '请填写名称和 4–32 位户号（数字、字母或连字符）' : '请填写日期和大于零的金额');
      return;
    }
    const success = await mutate(account ? '/accounts' : '/expenses', 'POST', account ? { category, name, number } : { category, cents, date, note });
    if (success) setDialog(undefined);
    else setFormError('保存失败，请检查输入或查看页面提示。');
  }
  return <div className="billing-page">
    <section className="panel billing-overview">
      <div className="billing-summary"><div><small>{month} 已记支出</small><strong>{money(monthly)}</strong></div><div><small>缴费账户</small><strong>{state.accounts.length}</strong></div></div>
      <div className="billing-location"><span className="icon-box"><MapPin size={18} /></span><span><strong>杭州</strong><small>水费 · 电费 · 燃气费</small></span></div>
      <div className="button-row"><Button onClick={() => open('expense')}>记一笔</Button><Button type="primary" onClick={() => open('account')}>添加账户</Button></div>
    </section>
    <div className="two-col billing-cols">
      <section className="panel"><h2>官方查询渠道</h2><div className="channels">{channels.map(({ name, href, icon: Icon }, index) =>
        <a key={name} href={href} target="_blank" rel="noreferrer"><span className="icon-box"><Icon size={19} /></span><span><strong>{categories[index]}</strong><small>{name}</small></span><ArrowUpRight size={16} /></a>)}</div></section>
      <section className="panel"><h2>我的账户</h2>
        {state.accounts.length ? <ul className="records">{state.accounts.map((account) => <li key={account.id}><span>{account.name}<small>{account.category}</small></span><span>{account.masked}</span></li>)}</ul> :
          <div className="empty"><ReceiptText size={24} /><p>暂无账户</p><Button onClick={() => open('account')}>添加账户</Button></div>}
      </section>
    </div>
    <div className="two-col billing-lower">
      <section className="panel"><h2>近 6 个月费用</h2>{months.some(({ cents }) => cents > 0) ? <ul className="history">
        {months.map(({ key, cents }) => <li key={key}><span>{key}</span><div><i style={{ width: (cents / max * 100) + '%' }} /></div><strong>{money(cents)}</strong></li>)}
      </ul> : <p className="empty">暂无费用数据</p>}</section>
      <section className="panel"><h2>最近记录</h2>{state.expenses.length ? <ul className="records">{[...state.expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).map((expense) =>
        <li key={expense.id}><span>{expense.category}{expense.note && ' · ' + expense.note}<small>{expense.date}</small></span><strong>{money(expense.cents)}</strong></li>)}</ul> : <p className="empty">暂无账单记录</p>}</section>
    </div>
    <Modal visible={!!dialog} title={dialog === 'account' ? '添加账户' : '记一笔'} onCancel={() => { if (!busy) setDialog(undefined); }} confirmLoading={busy} onOk={() => void submit()} okText="保存" cancelText="取消">
      <label className="form-field"><span>类型</span><Select aria-label="费用类型" value={category} onChange={setCategory} options={[...categories]} /></label>
      {dialog === 'account' ? <>
        <label className="form-field"><span>账户名称</span><Input value={name} onChange={setName} maxLength={80} /></label>
        <label className="form-field"><span>户号</span><Input.Password value={number} onChange={setNumber} maxLength={32} /></label>
      </> : <>
        <label className="form-field"><span>金额（元）</span><InputNumber value={amount} onChange={setAmount} min={0.01} max={1000000} precision={2} /></label>
        <label className="form-field"><span>日期</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label className="form-field"><span>备注</span><Input value={note} onChange={setNote} maxLength={120} /></label>
      </>}
      {formError && <p role="alert" className="error-text">{formError}</p>}
    </Modal>
  </div>;
}
