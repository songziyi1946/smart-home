import { Solar } from 'lunar-typescript';
import './style.css';

const chinaDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' });

export default function TodayAlmanac({ now }: { now: Date }) {
  const date = chinaDate.format(now);
  const [year, month, day] = date.split('-').map(Number);
  const solar = Solar.fromYmd(year, month, day);
  const lunar = solar.getLunar();
  const occasions = [lunar.getJieQi(), ...lunar.getFestivals()].filter(Boolean);

  return <section id="today-almanac" className="today-almanac" role="dialog" aria-label="今日黄历">
    <div className="today-almanac-heading">
      <div><strong>今日黄历</strong><time dateTime={date}>{year}年{month}月{day}日 · 星期{solar.getWeekInChinese()}</time></div>
      <b>农历{lunar.getMonthInChinese()}月{lunar.getDayInChinese()}</b>
    </div>
    <p className="today-almanac-ganzhi">{lunar.getYearInGanZhi()}{lunar.getYearShengXiao()}年 · {lunar.getMonthInGanZhi()}月 · {lunar.getDayInGanZhi()}日</p>
    {occasions.length > 0 && <p className="today-almanac-occasion">{occasions.join(' · ')}</p>}
    <dl className="today-almanac-activities">
      <div><dt>宜</dt><dd>{lunar.getDayYi().join('、') || '无'}</dd></div>
      <div><dt>忌</dt><dd>{lunar.getDayJi().join('、') || '无'}</dd></div>
    </dl>
  </section>;
}
