import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Today from "./mobile/Today.tsx";
import { speechError } from "./mobile/speech.ts";

const empty = {
  devices: [],
  scenes: [],
  sceneRuns: [],
  automations: [],
  automationRuns: [],
};
const render = (state, props = {}) =>
  renderToStaticMarkup(
    React.createElement(Today, {
      state,
      live: true,
      busy: false,
      canViewAutomation: true,
      mutate: async () => true,
      onRoom() {},
      onOffline() {},
      onOpen() {},
      ...props,
    }),
  );
test("mobile today labels demonstration plans and missing telemetry without invented occupancy", () => {
  const html = render(empty);
  assert.match(html, /情境演示/);
  assert.equal((html.match(/today-demo-badge/g) ?? []).length, 2);
  assert.match(html, /演示草稿/);
  assert.match(html, /暂未接入在家感应/);
  assert.match(html, /暂无数据/);
  assert.doesNotMatch(html, /全家在家|小禾在家|today-warning/);
});
test("actual scenes, cache labels and failures retain restrictions", () => {
  const state = {
    ...empty,
    scenes: [
      {
        id: "home",
        name: "真实场景名称",
        actions: [],
        description: "已保存动作",
      },
    ],
    sceneRuns: [{ sceneId: "home", name: "真实场景名称", status: "running" }],
    automations: [{ id: "rule" }],
    automationRuns: [{ ruleId: "rule", name: "规则", status: "failed" }],
  };
  const html = render(state, { live: false, canViewAutomation: false });
  assert.match(html, /真实场景名称/);
  assert.match(html, /上次同步的家庭状态/);
  assert.match(html, /disabled/);
  assert.doesNotMatch(html, /href="#automation"/);
});
test("speech errors explain permission, network and unknown failure recovery", () => {
  assert.match(speechError("not-allowed"), /权限/);
  assert.match(speechError("network"), /网络/);
  assert.match(speechError("unknown"), /重试/);
});
