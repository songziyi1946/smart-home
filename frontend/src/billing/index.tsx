import { StatusPanel } from "../ui/StatusPanel";
import { useState } from "react";
import { Button } from "@arco-design/web-react";
import {
  Zap,
  Droplets,
  Flame,
  Smartphone,
  ArrowUpRight,
  Plus,
  ArrowLeft,
} from "lucide-react";
import { categories } from "../constants";
import type { Category } from "../constants";
import type { State, Mutate } from "../types";
import { localDate } from "../utils";
import { useMobile } from "../mobile/hooks";
import {
  channels,
  money,
  recordedSummary,
  filterExpenses,
  recentMonths,
} from "./model";
import "./style.css";
const iconFor = (category: Category) =>
  category === "电费"
    ? Zap
    : category === "水费"
      ? Droplets
      : category === "燃气费"
        ? Flame
        : Smartphone;
export default function Billing({
  state,
  busy,
  pending = false,
  mutate,
}: {
  state: State;
  busy: boolean;
  pending?: boolean;
  mutate: Mutate;
}) {
  const mobile = useMobile();
  const [view, setView] = useState("overview"),
    [month, setMonth] = useState(() => localDate().slice(0, 7)),
    [historyMonth, setHistoryMonth] = useState(""),
    [historyCategory, setHistoryCategory] = useState<Category | "all">("all"),
    [limit, setLimit] = useState(20);
  const [dialog, setDialog] = useState<"account" | "expense">(),
    [category, setCategory] = useState<Category>("电费"),
    [name, setName] = useState(""),
    [number, setNumber] = useState(""),
    [amount, setAmount] = useState(""),
    [date, setDate] = useState(localDate),
    [note, setNote] = useState(""),
    [formError, setFormError] = useState("");
  const monthly = recordedSummary(filterExpenses(state.expenses, month, "all")),
    months = recentMonths(state.expenses, month),
    max = Math.max(1, ...months.map((m) => m.cents));
  const history = filterExpenses(state.expenses, historyMonth, historyCategory),
    historySummary = recordedSummary(history);
  function open(kind: "account" | "expense", preset: Category = "电费") {
    setCategory(preset);
    setName("");
    setNumber("");
    setAmount("");
    setDate(localDate());
    setNote("");
    setFormError("");
    setDialog(kind);
  }
  async function submit() {
    if (busy) return;
    const cents = Math.round(Number(amount) * 100),
      account = dialog === "account";
    if (
      account
        ? !name.trim() || !/^[\dA-Za-z-]{4,32}$/.test(number.trim())
        : !Number.isFinite(cents) || cents < 1 || cents > 100000000 || !date
    ) {
      setFormError(
        account
          ? "请填写名称和 4–32 位户号（数字、字母或连字符）"
          : "请填写有效日期及 0.01–1,000,000 元的金额",
      );
      return;
    }
    if (
      await mutate(
        account ? "/accounts" : "/expenses",
        "POST",
        account
          ? { category, name: name.trim(), number: number.trim() }
          : { category, cents, date, note: note.trim() },
      )
    ) {
      setDialog(undefined);
      setNumber("");
    } else setFormError("保存未完成，请查看页面提示后重试。");
  }
  const energy = (
    <section className="panel ledger-energy">
      <h2>能源用量</h2>
      <div>
        {[
          { name: "用电量", Icon: Zap },
          { name: "用水量", Icon: Droplets },
          { name: "燃气用量", Icon: Flame },
        ].map(({ name, Icon }) => (
          <article key={name}>
            <Icon size={18} />
            <span>{name}</span>
            <strong>暂无数据</strong>
          </article>
        ))}
      </div>
      <p>尚未接入计量数据，记账金额不代表能源用量。</p>
    </section>
  );
  const payments = (
    <section className="panel ledger-payments">
      <header>
        <div>
          <h2>缴费与查询</h2>
          <p>打开渠道网站办理，本站不收款、不查询欠费。</p>
        </div>
      </header>
      <div className="ledger-channels">
        {categories.map((c) => {
          const channel = channels[c],
            Icon = iconFor(c);
          return (
            <a
              key={c}
              href={channel.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${c} · ${channel.name}（新窗口）`}
            >
              <Icon size={21} />
              <span>
                <strong>{c}</strong>
                <small>
                  {channel.name} · {channel.area}
                </small>
              </span>
              <ArrowUpRight size={16} />
            </a>
          );
        })}
      </div>
      <p className="ledger-hint">
        水务与燃气入口目前适用于杭州，请按实际服务地区办理。打开渠道不会生成缴费成功记录。
      </p>
    </section>
  );
  const accounts = (
    <section className="panel ledger-accounts">
      <header>
        <div>
          <h2>
            缴费账户 <small>{state.accounts.length}</small>
          </h2>
          <p>户号仅显示脱敏信息，余额与欠费暂无数据。</p>
        </div>
        <Button disabled={busy} onClick={() => open("account")}>
          添加账户
        </Button>
      </header>
      {state.accounts.length ? (
        <ul>
          {state.accounts.map((a) => (
            <li key={a.id}>
              <div>
                <strong>{a.name}</strong>
                <small>
                  {a.category} · {a.masked}
                </small>
              </div>
              <a
                href={channels[a.category].href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${a.name}去渠道缴费（新窗口）`}
              >
                去缴费 <ArrowUpRight size={14} />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <StatusPanel
          compact
          kind="empty"
          title="暂无缴费账户"
          description="可以直接使用渠道入口，也可以添加户号备查。"
        />
      )}
    </section>
  );
  const records = (
    <section className="panel ledger-records">
      <header>
        <div>
          <h2>费用记录</h2>
          <p>手工记录，不等同于渠道账单或支付凭证。</p>
        </div>
        <Button disabled={busy} onClick={() => open("expense")}>
          记一笔
        </Button>
      </header>
      <div className="ledger-filters">
        <label>
          月份
          <input
            aria-label="筛选记录月份"
            type="month"
            value={historyMonth}
            onInput={(e) => {
              setHistoryMonth(e.currentTarget.value);
              setLimit(20);
            }}
          />
        </label>
        <label>
          类别
          <select
            aria-label="筛选费用类别"
            value={historyCategory}
            onChange={(e) => {
              setHistoryCategory(e.target.value as Category | "all");
              setLimit(20);
            }}
          >
            <option value="all">全部类别</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {(historyMonth || historyCategory !== "all") && (
          <button
            onClick={() => {
              setHistoryMonth("");
              setHistoryCategory("all");
              setLimit(20);
            }}
          >
            清除筛选
          </button>
        )}
      </div>
      <div className="ledger-record-total">
        <span>{history.length} 笔记录</span>
        <strong>
          {history.length ? money(historySummary.cents) : "暂无记录"}
        </strong>
      </div>
      {history.length ? (
        <>
          <ul className="ledger-record-list">
            {history.slice(0, limit).map((e) => (
              <li key={e.id}>
                <span className="ledger-record-date">{e.date}</span>
                <div>
                  <strong>{e.category}</strong>
                  <small>{e.note || "未填写备注"}</small>
                </div>
                <strong>{money(e.cents)}</strong>
              </li>
            ))}
          </ul>
          {history.length > limit && (
            <Button long onClick={() => setLimit(limit + 20)}>
              显示更多记录
            </Button>
          )}
        </>
      ) : (
        <StatusPanel
          compact
          kind="empty"
          title={state.expenses.length ? "没有匹配的费用记录" : "暂无费用记录"}
          description={
            state.expenses.length
              ? "调整月份或类别，或清除筛选查看全部记录。"
              : "记一笔实际支出后，即可查看费用汇总。"
          }
        />
      )}
    </section>
  );
  if (dialog)
    return (
      <section className="panel ledger-editor">
        <header>
          <div>
            <small>能源与缴费 / {dialog === "account" ? "账户" : "费用"}</small>
            <h2>{dialog === "account" ? "添加缴费账户" : "记录一笔支出"}</h2>
          </div>
          <Button
            icon={<ArrowLeft size={16} />}
            disabled={pending}
            onClick={() => {
              setDialog(undefined);
              setNumber("");
            }}
          >
            返回
          </Button>
        </header>
        <p className="ledger-hint">
          {dialog === "account"
            ? "账户用于户号备查，添加后不会自动连接服务商。"
            : "填写实际发生的支出；这里不会发起支付，也不会验证缴费结果。"}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={busy}>
            <label>
              费用类别
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
              >
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            {dialog === "account" ? (
              <>
                <label>
                  账户名称
                  <input
                    required
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如：家里的电费账户"
                  />
                </label>
                <label>
                  户号
                  <input
                    required
                    type="password"
                    autoComplete="off"
                    minLength={4}
                    maxLength={32}
                    pattern="[0-9A-Za-z\-]{4,32}"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  金额（元）
                  <input
                    required
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label>
                  支出日期
                  <input
                    required
                    type="date"
                    value={date}
                    onInput={(e) => setDate(e.currentTarget.value)}
                  />
                </label>
                <label>
                  备注
                  <input
                    maxLength={120}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="例如：本月电费"
                  />
                </label>
              </>
            )}
            {formError && (
              <p role="alert" className="ledger-error">
                {formError}
              </p>
            )}
            <Button type="primary" htmlType="submit" loading={pending}>
              保存{dialog === "account" ? "账户" : "记录"}
            </Button>
          </fieldset>
        </form>
      </section>
    );
  return (
    <div className={"ledger-page " + (mobile ? "ledger-mobile" : "")}>
      {mobile && (
        <nav className="ledger-tabs" aria-label="费用页面视图">
          {[
            { id: "overview", label: "费用概况" },
            { id: "pay", label: "快捷缴费" },
            { id: "history", label: "历史记录" },
          ].map((v) => (
            <button
              key={v.id}
              aria-pressed={view === v.id}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </nav>
      )}
      {(!mobile || view === "overview") && (
        <>
          <section className="panel ledger-overview">
            <header>
              <div>
                <span className="ledger-eyebrow">家庭费用 · 手工记录</span>
                <h2>把日常支出，看清楚</h2>
              </div>
              <label className="ledger-month">
                统计月份
                <input
                  aria-label="统计月份"
                  type="month"
                  required
                  value={month}
                  onInput={(e) => {
                    if (e.currentTarget.value) setMonth(e.currentTarget.value);
                  }}
                />
              </label>
            </header>
            <div className="ledger-summary">
              <div>
                <span>所选月份已记录</span>
                <strong>
                  {monthly.count ? money(monthly.cents) : "暂无记录"}
                </strong>
                <small>{monthly.count} 笔支出 · 非待缴金额</small>
              </div>
              <div className="ledger-summary-actions">
                {mobile && (
                  <Button type="primary" onClick={() => setView("pay")}>
                    去缴费
                  </Button>
                )}
                <Button
                  disabled={busy}
                  icon={<Plus size={16} />}
                  onClick={() => open("expense")}
                >
                  记一笔
                </Button>
                {!mobile && (
                  <Button
                    onClick={() =>
                      document
                        .getElementById("ledger-payment-area")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                  >
                    查看缴费入口
                  </Button>
                )}
              </div>
            </div>
            <div className="ledger-category-summary">
              {monthly.categories.map((c) => {
                const Icon = iconFor(c.category);
                return (
                  <button
                    key={c.category}
                    onClick={() => {
                      setHistoryMonth(month);
                      setHistoryCategory(c.category);
                      setLimit(20);
                      if (mobile) setView("history");
                      else
                        document
                          .getElementById("ledger-history-area")
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          });
                    }}
                  >
                    <span>
                      <Icon size={16} />
                      {c.category}
                    </span>
                    <strong>{c.count ? money(c.cents) : "暂无记录"}</strong>
                  </button>
                );
              })}
            </div>
          </section>
          {!mobile && (
            <div className="ledger-desktop-grid">
              <div className="ledger-stack">
                <section className="panel ledger-trend">
                  <header>
                    <div>
                      <h2>近 6 个月已记录费用</h2>
                      <p>截至 {month}，只统计已录入的支出。</p>
                    </div>
                  </header>
                  {months.some((m) => m.count > 0) ? (
                    <ul>
                      {months.map((m) => (
                        <li key={m.key}>
                          <span>{m.key}</span>
                          <div>
                            <i style={{ width: (m.cents / max) * 100 + "%" }} />
                          </div>
                          <strong>
                            {m.count ? money(m.cents) : "暂无记录"}
                          </strong>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ledger-empty">这段时间暂无费用记录</p>
                  )}
                </section>
                {energy}
              </div>
              <div className="ledger-stack" id="ledger-payment-area">
                {payments}
                {accounts}
              </div>
            </div>
          )}
          {mobile && (
            <>
              <section className="panel ledger-recent">
                <header>
                  <h2>最近支出</h2>
                  <button onClick={() => setView("history")}>查看全部 →</button>
                </header>
                {state.expenses.length ? (
                  <ul>
                    {filterExpenses(state.expenses, "", "all")
                      .slice(0, 3)
                      .map((e) => (
                        <li key={e.id}>
                          <div>
                            <strong>{e.category}</strong>
                            <small>{e.date}</small>
                          </div>
                          <strong>{money(e.cents)}</strong>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="ledger-hint">
                    暂无记录，记一笔后会显示在这里。
                  </p>
                )}
              </section>
              <details className="ledger-energy-disclosure">
                <summary>能源用量 · 暂无数据</summary>
                {energy}
              </details>
            </>
          )}
        </>
      )}
      {mobile && view === "pay" && (
        <>
          {state.accounts.length > 0 && accounts}
          {payments}
          {state.accounts.length === 0 && accounts}
          <Button disabled={busy} onClick={() => open("expense")}>
            缴费后记一笔
          </Button>
        </>
      )}
      {(!mobile || view === "history") && (
        <div id="ledger-history-area">{records}</div>
      )}
    </div>
  );
}
