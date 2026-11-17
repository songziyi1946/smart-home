import { categories } from "../constants";
import type { Category } from "../constants";
import type { State } from "../types";
import { localDate } from "../utils";
export const money = (cents: number) =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(
    cents / 100,
  );
export const channels: Record<
  Category,
  { name: string; href: string; area: string }
> = {
  电费: {
    name: "网上国网",
    href: "https://www.95598.cn/",
    area: "国网服务地区",
  },
  水费: { name: "杭州水务", href: "http://www.hzwgc.com/", area: "杭州" },
  燃气费: { name: "杭州天然气", href: "https://www.hzng.cn/", area: "杭州" },
  移动话费: {
    name: "中国移动",
    href: "https://www.10086.cn/",
    area: "按所在地办理",
  },
  联通话费: {
    name: "中国联通",
    href: "https://www.10010.com/",
    area: "按所在地办理",
  },
  电信话费: {
    name: "中国电信",
    href: "https://www.189.cn/",
    area: "按所在地办理",
  },
};
export function recordedSummary(expenses: State["expenses"]) {
  return {
    count: expenses.length,
    cents: expenses.reduce((sum, e) => sum + e.cents, 0),
    categories: categories.map((category) => ({
      category,
      cents: expenses
        .filter((e) => e.category === category)
        .reduce((sum, e) => sum + e.cents, 0),
      count: expenses.filter((e) => e.category === category).length,
    })),
  };
}
export function filterExpenses(
  expenses: State["expenses"],
  month: string,
  category: Category | "all",
) {
  return expenses
    .filter(
      (e) =>
        (!month || e.date.startsWith(month)) &&
        (category === "all" || e.category === category),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
}
export function recentMonths(expenses: State["expenses"], month: string) {
  const [year, m] = month.split("-").map(Number);
  return Array.from({ length: 6 }, (_, i) => {
    const key = localDate(new Date(year, m - 6 + i, 1)).slice(0, 7);
    return { key, ...recordedSummary(filterExpenses(expenses, key, "all")) };
  });
}
