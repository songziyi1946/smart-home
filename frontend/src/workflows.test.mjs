import test from "node:test";
import assert from "node:assert/strict";
import {
  actionText,
  valueText,
  windowText,
  previewInstant,
  deviceName,
  writable,
  initialValue,
} from "./workflows/model.ts";
import { DeviceCommand } from "../../backend/domain/devices/model.mjs";
test("workflow summaries preserve false, zero, unknown and capability units", () => {
  assert.equal(
    actionText({ capability: "power", value: false }),
    "电源 · 关闭",
  );
  assert.equal(valueText("brightness", 0), "0%");
  assert.equal(valueText("occupancy", false), "无人活动");
  assert.equal(valueText("temperature", undefined), "未知");
  assert.equal(valueText("position", "stop"), "停止");
  assert.equal(deviceName([], "removed"), "设备已移除（removed）");
  for (const capability of writable)
    assert.equal(
      DeviceCommand.safeParse({ capability, value: initialValue(capability) })
        .success,
      true,
      capability,
    );
});
test("cross-midnight conditions and local preview instant stay explicit", () => {
  assert.equal(windowText("22:00", "06:30"), "22:00 — 次日 06:30");
  assert.equal(windowText("08:00", "18:00"), "08:00 — 18:00");
  assert.equal(previewInstant(""), undefined);
  assert.equal(
    previewInstant("2026-11-17T23:30"),
    new Date(2026, 10, 17, 23, 30).toISOString(),
  );
  assert.throws(() => previewInstant("invalid"));
});

test("execution detail uses stored action results and exposes recovery without inventing success", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { SceneResult } = await import("./workflows/Shared.tsx");
  const run = {
    id: "old",
    name: "夜灯",
    status: "failed",
    reason: "设备已离线",
    actions: [
      {
        deviceId: "missing",
        command: { capability: "power", value: true },
        status: "failed",
        reason: "设备已离线",
      },
      {
        deviceId: "missing",
        command: { capability: "brightness", value: 15 },
        status: "skipped",
        reason: "前序动作失败，未执行",
      },
    ],
  };
  const html = renderToStaticMarkup(
    React.createElement(SceneResult, { run, devices: [] }),
  );
  assert.match(html, /设备已离线/);
  assert.match(html, /15%/);
  assert.match(html, /前序动作失败，未执行/);
  assert.match(html, /href="#devices"/);
  assert.doesNotMatch(html, /动作已下发/);
});
test("failure entry targets its own historical run even past first page", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { History } = await import("./workflows/Shared.tsx");
  const runs = Array.from({ length: 25 }, (_, i) => ({
    id: String(i),
    name: "记录" + i,
    status: i === 24 ? "failed" : "completed",
    startedAt: "2026-11-17T00:00:00Z",
  }));
  const html = renderToStaticMarkup(
    React.createElement(History, {
      runs,
      initialRunId: "24",
      render: (run) => React.createElement("p", null, "详情：" + run.id),
    }),
  );
  assert.match(html, /详情：24/);
  assert.match(html, /aria-pressed="true"[^]*?记录24/);
});
