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
  const payments = (
    <section className="ledger-payments">
      <header>
        <h2>缴费渠道</h2>
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
              title={channel.area}
              aria-label={`${c} · ${channel.name}（${channel.area}，新窗口）`}
            >
              <Icon size={21} />
              <span>
                <strong>{c}</strong>
                <small>{channel.name}</small>
              </span>
              <ArrowUpRight size={16} />
            </a>
          );
        })}
      </div>
    </section>
  );
  const accounts = (
    <section className="ledger-accounts">
      <header>
        <h2>缴费账户</h2>
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
        <p className="ledger-empty">暂无缴费账户</p>
      )}
    </section>
  );
  const records = (
    <section className="panel ledger-records">
      <header>
        <h2>手工账单</h2>
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
          <Button
            onClick={() => {
              setHistoryMonth("");
              setHistoryCategory("all");
              setLimit(20);
            }}
          >
            清除筛选
          </Button>
        )}
      </div>
      {history.length ? (
        <>
          <div className="ledger-record-total">
            <span>{history.length} 笔记录</span>
            <strong>{money(historySummary.cents)}</strong>
          </div>
          <ul className="ledger-record-list">
            {history.slice(0, limit).map((e) => (
              <li key={e.id}>
                <span className="ledger-record-date">{e.date}</span>
                <div>
                  <strong>{e.category}</strong>
                  {e.note && <small>{e.note}</small>}
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
        />
      )}
    </section>
  );
  if (dialog)
    return (
      <section className="panel ledger-editor">
        <header>
          <div>
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
    <div className="ledger-page">
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
              <h2>费用概况</h2>
              <div className="ledger-overview-tools">
                <label>
                  统计月份
                  <input
                    type="month"
                    required
                    value={month}
                    onInput={(e) => {
                      if (e.currentTarget.value)
                        setMonth(e.currentTarget.value);
                    }}
                  />
                </label>
                <Button
                  type="primary"
                  disabled={busy}
                  icon={<Plus size={16} />}
                  onClick={() => open("expense")}
                >
                  记一笔
                </Button>
                <Button
                  onClick={() => {
                    if (mobile) setView("pay");
                    else
                      document
                        .getElementById("ledger-payment-area")
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        });
                  }}
                >
                  缴费入口
                </Button>
              </div>
            </header>
            <div className="ledger-summary">
              <div>
                <span>已记支出</span>
                <strong>{monthly.count ? money(monthly.cents) : "—"}</strong>
              </div>
              <div>
                <span>支出笔数</span>
                <strong>{monthly.count}</strong>
              </div>
              <p className="ledger-meter-empty">
                <Zap size={15} aria-hidden />
                能源计量尚未接入
              </p>
            </div>
          </section>
          <section className="panel ledger-analysis">
            <div className="ledger-trend">
              <header>
                <h2>近 6 个月支出</h2>
              </header>
              {months.some((m) => m.count > 0) ? (
                <ul>
                  {months.map((m) => (
                    <li key={m.key}>
                      <span>{m.key}</span>
                      <div aria-hidden>
                        <i style={{ width: (m.cents / max) * 100 + "%" }} />
                      </div>
                      <strong>{m.count ? money(m.cents) : "—"}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ledger-empty">这段时间暂无费用记录</p>
              )}
            </div>
            {monthly.count > 0 && (
              <div className="ledger-breakdown">
                <header>
                  <h2>月度分类支出</h2>
                </header>
                <div className="ledger-category-summary">
                  {monthly.categories
                    .filter((c) => c.count > 0)
                    .map((c) => {
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
                          <strong>{money(c.cents)}</strong>
                          <ArrowUpRight size={15} aria-hidden />
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </section>
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
                  <p className="ledger-empty">暂无最近支出</p>
                )}
              </section>
            </>
          )}
        </>
      )}
      {(!mobile || view === "pay") && (
        <div className="panel ledger-payment-area" id="ledger-payment-area">
          {payments}
          {accounts}
        </div>
      )}
      {mobile && view === "pay" && (
        <Button disabled={busy} onClick={() => open("expense")}>
          缴费后记一笔
        </Button>
      )}
      {(!mobile || view === "history") && (
        <div id="ledger-history-area">{records}</div>
      )}
    </div>
  );
}
