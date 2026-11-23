import { useMobile } from "../mobile/hooks";
import { StatusPanel } from "../ui/StatusPanel";
import { useState } from "react";
import {
  Search,
  SlidersHorizontal,
  Grid2X2,
  List,
} from "lucide-react";
import type { State, Mutate, User } from "../types";
import { roomOptions } from "../deviceControls/model";
import DesktopDeviceCard from "./DeviceCard";
import { filterDevices, emptyFilters } from "./model";
import type { DeviceFilters } from "./model";
export default function Devices({
  state,
  busy,
  mutate,
  onOpen,
  filters,
  onFilters,
}: {
  state: State;
  busy: boolean;
  mutate: Mutate;
  onOpen: (id: string) => void;
  filters: DeviceFilters;
  onFilters: (filters: DeviceFilters) => void;
  role: User["role"];
}) {
  const mobile = useMobile();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [list, setList] = useState(false);
  const devices = filterDevices(state.devices, {...filters, favoritesOnly: false}, []);
  const update = (part: Partial<DeviceFilters>) =>
    onFilters({ ...filters, ...part });
  return (
    <div className="desktop-devices-page">
      <section className="panel device-directory">
        <div className="directory-search">
          <label>
            <Search size={18} />
            <input
              aria-label="搜索设备"
              placeholder="搜索设备名称、房间或标识"
              value={filters.query}
              onChange={(e) => update({ query: e.target.value })}
            />
          </label>
          <div className="directory-view">
            <button
              aria-label="卡片视图"
              aria-pressed={!list}
              onClick={() => setList(false)}
            >
              <Grid2X2 size={18} />
            </button>
            <button
              aria-label="紧凑视图"
              aria-pressed={list}
              onClick={() => setList(true)}
            >
              <List size={18} />
            </button>
          </div>

        </div>
        {mobile && (
          <button
            className="quiet-button directory-filter-toggle"
            aria-expanded={filtersOpen}
            aria-controls="device-filter-options"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <SlidersHorizontal size={16} />
            筛选条件
            {Object.keys(emptyFilters).some(
              (k) =>
                filters[k as keyof DeviceFilters] !==
                emptyFilters[k as keyof DeviceFilters],
            )
              ? " · 已设置"
              : ""}
          </button>
        )}
        {(!mobile || filtersOpen) && (
          <div className="directory-filters" id="device-filter-options">
            <label>
              房间
              <select
                value={filters.room}
                onChange={(e) => update({ room: e.target.value })}
              >
                <option value="all">全部房间</option>
                {roomOptions(state.devices).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              能力分类
              <select
                value={filters.category}
                onChange={(e) => update({ category: e.target.value })}
              >
                {Object.entries({
                  all: "全部类型",
                  light: "灯光",
                  climate: "温控",
                  cover: "窗帘",
                  cleaning: "清扫",
                  switch: "开关",
                  sensor: "传感器",
                }).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              连接状态
              <select
                value={filters.status}
                onChange={(e) => update({ status: e.target.value })}
              >
                <option value="all">全部状态</option>
                <option value="online">在线</option>
                <option value="offline">离线</option>
              </select>
            </label>
            <label>
              数据来源
              <select
                value={filters.source}
                onChange={(e) => update({ source: e.target.value })}
              >
                <option value="all">全部来源</option>
                <option value="simulator">模拟器</option>
                <option value="mock">本地模拟</option>
                <option value="home-assistant">Home Assistant</option>
              </select>
            </label>
            <button
              className="quiet-button"
              onClick={() => onFilters({ ...emptyFilters })}
            >
              重置筛选
            </button>
          </div>
        )}
        <div className="directory-count">
          <SlidersHorizontal size={15} />
          {devices.length} / {state.devices.length} 项设备记录
        </div>
        {devices.length ? (
          <div
            className={"desktop-device-grid" + (list ? " compact-list" : "")}
          >
            {devices.map((d) => (
              <DesktopDeviceCard
                key={d.id}
                device={d}
                busy={busy}
                mutate={mutate}
                onOpen={() => onOpen(d.id)}
              />
            ))}
          </div>
        ) : (
          <StatusPanel
            compact
            kind="empty"
            title={state.devices.length ? "没有匹配的设备" : "尚未发现设备"}
            action={
              state.devices.length ? (
                <button
                  className="quiet-button"
                  onClick={() => onFilters({ ...emptyFilters })}
                >
                  重置筛选
                </button>
              ) : undefined
            }
          />
        )}
      </section>

    </div>
  );
}
