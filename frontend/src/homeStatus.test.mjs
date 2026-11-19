import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HomeStatus from "./home/Status.tsx";
import { attention } from "./homeTelemetry.ts";

const device = (id, values, online = true) => ({
  id,
  name: id,
  room: "客厅",
  roomId: "living",
  capabilities: Object.keys(values),
  state: { online, source: "mock", values },
});
const empty = {
  devices: [],
  scenes: [],
  sceneRuns: [],
  automations: [],
  automationRuns: [],
};
const render = (state, props = {}) =>
  renderToStaticMarkup(
    React.createElement(HomeStatus, {
      state,
      live: true,
      canViewAutomation: true,
      onDevices() {},
      onOffline() {},
      onOpen() {},
      ...props,
    }),
  );

test("home status distinguishes missing devices from measured online rate and labels cached/mock sources", () => {
  const missing = render(empty);
  assert.match(missing, /设备在线率暂无数据/);
  assert.match(missing, /尚未发现设备/);
  assert.doesNotMatch(missing, /100%|家庭健康|安防正常/);
  const html = render(
    {
      ...empty,
      devices: [
        device("灯", { power: true }),
        device("离线传感器", { battery: 0 }, false),
      ],
    },
    { live: false },
  );
  assert.match(html, /设备在线率50%/);
  assert.match(html, /查看离线设备，1 项/);
  assert.match(html, /上次记录/);
  assert.match(html, /含 2 项模拟数据/);
});

test("both home layouts use latest failures and online low battery, with guest-safe navigation", () => {
  const state = {
    devices: [
      device("零电量", { battery: 0 }),
      device("离线", { battery: 0 }, false),
    ],
    scenes: [{ id: "home" }],
    sceneRuns: [
      { sceneId: "home", name: "回家", status: "completed" },
      { sceneId: "home", name: "旧失败", status: "failed" },
    ],
    automations: [{ id: "rule" }],
    automationRuns: [
      { ruleId: "removed", name: "已删除规则", status: "failed" },
      { ruleId: "rule", name: "夜灯", status: "failed" },
    ],
  };
  assert.deepEqual(
    attention(state).lowBattery.map((device) => device.id),
    ["零电量"],
  );
  const member = render(state);
  assert.match(member, /零电量/);
  assert.match(member, /电量 0%/);
  assert.match(member, /1 条自动化执行失败/);
  assert.doesNotMatch(member, /旧失败|已删除规则/);
  const guest = render(state, { canViewAutomation: false });
  assert.doesNotMatch(guest, /href="#automation"|夜灯/);
});
