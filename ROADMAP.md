# Smart Home / Home OS Development Roadmap

## Product North Star

Build a household digital hub that makes users control devices **less often** by understanding rooms, device state, routines, household tasks and automation.

The first success criterion is not “support many brands”. It is:

> A second household can install/configure the product without editing source code and can reliably use it every day.

---

## Phase 0 — Stabilize the engineering baseline

### Goal
Make the current repository reproducible and safe to evolve with AI-assisted coding.

### Work

- [x] Exclude `node_modules` and generated `dist` from source distributions; `.gitignore` and `.gitattributes` cover dependencies/build output, and source archives also exclude local runtime data/configuration.
- [x] Use npm for both packages with committed `package-lock.json` files; remove the frontend Yarn lockfile. Record Node 22 in `.nvmrc`.
- [x] Add frontend scripts for `typecheck`, `test`, and `build`.
- [x] Run existing Node-based TS tests through explicit TypeScript support (`node --import tsx --test`), preserving existing assertions.
- Defer ESLint + formatting until a consistently used style policy is established; this is conditional, not a P0 blocker.
- [x] Add a minimal CI workflow: backend tests + frontend typecheck/tests/build (`.github/workflows/ci.yml`). This runs on GitHub, not automatically on the current Gitee origin.
- [x] Add `.env.example` for runtime configuration, with explicit shell-loading instructions.
- [x] Keep the current auth implementation and its passing tests.

### Exit criteria

- Fresh clone → install → tests → build succeeds on a clean machine.
- No application feature depends on copied `node_modules`.

### Verification status — 2026-11-16

Implementation and local clean-source verification are complete. A separate source snapshot without `node_modules` or `dist` passed fresh `npm ci` installs for both packages using Node 22.23.1/npm 10.9.8, 17 backend tests, 8 frontend tests, frontend typecheck and production build. Archive exclusion rules were checked using a disposable Git archive fixture. Existing bundle-size warnings remain.

Hosted CI / a fresh clone on a separate Linux machine has not been verified. The current origin is Gitee; push the changes to a GitHub repository/mirror with Actions enabled, or configure the same commands in the chosen CI service. Local verification does not claim a remote CI pass.

---

## Phase 1 — Replace the demo device model with a household domain model

### Goal
Stop building features around four hard-coded device kinds.

### Work

Introduce stable domain concepts:

- Household
- Room
- Device
- Capability
- DeviceState
- DeviceCommand
- Scene
- AutomationRule
- Event / AutomationRun

Change room identity from display names such as `客厅` to stable IDs with localized labels.

Refactor `Device` from a discriminated `kind` union toward capabilities. Start with current controls:

- `power`
- `brightness`
- `position`
- `battery`
- `cleaning`

Then make `DeviceRow` render controls from capabilities rather than adding more `device.kind === ...` branches.

### Also fix product truthfulness

Replace or clearly mark current demo data:

- 24.5°C / 35% humidity;
- PM2.5 / AQI;
- “已布防”;
- “门锁已上锁”;
- “X 台设备在线”;
- estimated power calculation.

An unknown value should display “未接入 / 暂无数据”, not a fabricated healthy value.

### Exit criteria

A new mock device with supported capabilities can appear and be controlled without adding a new top-level device kind branch throughout the UI.

---

## Phase 2 — Move from JSON state to SQLite and modularize the backend

### Goal
Give the domain a persistence model that can support history, external devices and future migration.

### Work

Use SQLite for the local/self-hosted product first.

Recommended initial tables/entities:

- households
- users / memberships
- rooms
- provider_connections
- devices
- device_capabilities or normalized capability config
- scenes / scene_actions
- automation_rules
- events / automation_runs
- utility_accounts / expenses
- maintenance_items

Split `backend/server.mjs` incrementally into routes → services/domain → repositories/providers.

Consider migrating backend code to TypeScript when introducing shared API contracts; do it as a controlled migration, not a full rewrite.

### Exit criteria

Restarting the backend preserves normalized household data and event history; domain logic is testable without HTTP.

---

### SQLite implementation status — 2026-11-16

Business state, normalized Provider cache and authentication records now use SQLite through backend/infrastructure/sqlite-store.mjs. Legacy state.json/auth.json are imported once in a transaction with protected content-addressed backups. Device capabilities and scene actions have separate rows; complex versioned rules/logs remain JSON columns. APIs, SSE and UI contracts remain unchanged. Interrupted runs are recovered without replaying physical commands; Provider cache is offline until revalidated.

The initial SQLite validation used Node 26.13.1 / npm 11.20.0. On that version, 40 backend, 12 frontend and 7 simulator tests passed, plus typecheck/build and real HA/MQTT E2E. E2E restarted the backend and verified restored devices/scenes/rules/logs, one-time migration, SSE resync and another successful low-brightness automation execution.

## Phase 3 — Create the Provider layer before connecting Xiaomi

### Goal
Make Xiaomi the first provider, not the architecture.

### Work

Implement a provider interface with:

- list/discover devices;
- obtain current state;
- execute commands;
- subscribe to state/events where available.

Build implementations in this order:

1. `MockProvider` — deterministic fixtures for development/tests.
2. A personal real-device adapter for your own household.
3. Later, providers that have clear commercial/API authorization or standard protocols such as Matter.

Normalize every provider device into the same domain capability model.

### Xiaomi/Home Assistant caution

The official Xiaomi Home integration for Home Assistant is useful for personal validation, but its current license limits the licensed work and related Xiaomi cloud API interface to Home Assistant non-commercial use and explicitly does not authorize using it to develop an independent App/Web service. Treat it as a personal validation path, not a commercial dependency unless authorization changes or separate permission exists.

### Exit criteria

The UI cannot tell whether a device came from `MockProvider` or the first real provider.

---

### Phase 3 implementation status — 2026-11-16

`MockProvider` and server-only `HomeAssistantProvider` are implemented. HA REST discovery/state/service calls and authenticated WebSocket `state_changed` subscription normalize entities into domain capabilities. MQTT Discovery lab devices cover light, climate, cover, temperature/humidity sensors, binary_sensor and vacuum.

The real Docker HA 2026.11.1/Mosquitto 2.0.22 lab passed API end-to-end discovery, commands, external state changes, offline state and credential-isolation checks. The browser consumes authenticated SSE snapshots with reconnect resynchronization; no new generic UI controls were introduced. Physical hardware, multi-entity physical-device aggregation and hosted deployment are outside this validation.

## Phase 4 — Add realtime device state and an event model

### Goal
Handle the fact that a physical home changes outside this web app.

### Work

- Add normalized provider events.
- Store important events with timestamps/source IDs.
- Add SSE first unless bidirectional WebSocket behavior is genuinely required.
- Track device `online`, `lastSeenAt`, and stale state.
- Make UI update when a wall switch/app/sensor changes state externally.
- Add reconnect/backoff behavior for provider connections.

### Exit criteria

Turning a real device on outside this app updates the dashboard without reloading the page.

---

## Phase 5 — Make scenes data-driven and user-configurable

### Goal
Turn “回家/离家/睡眠” from code branches into reusable lifestyle scenes.

### Work

- Scene CRUD.
- Scene actions referencing device + capability + value.
- Ordered or parallel execution policy.
- Partial-failure reporting.
- Scene templates: 回家、离家、睡眠、阅读、观影、聚餐、清洁.
- Scene editor UI with capability-based action selection.

### Exit criteria

A user can create a new “阅读” scene without changing frontend/backend source code.

---

### Scene implementation status — 2026-11-16

Persisted scene CRUD, version-checked edits, capability-based action editor, sequential Provider execution, stop-on-failure results and latest 50 runs are implemented. Home/away/sleep are migrated once from local devices and remain editable/deletable. Admins manage definitions; members/guests execute, and guests see only their own run records. HA simulator validation covers CRUD, actual light/cover feedback via SSE, offline failure and skipped remaining actions. Parallel execution and additional template catalogs are deferred.

## Phase 6 — Build a real automation engine

### Goal
Replace descriptive rule strings with executable structured automation.

### Work

Support a small, deliberate first rule grammar:

**Triggers**
- time/schedule;
- device property changed;
- sensor threshold;
- household/member event;
- scene invoked.

**Conditions**
- time window;
- device state;
- occupancy/home state;
- AND/OR groups kept intentionally simple at first.

**Actions**
- device command;
- run scene;
- notification;
- delay only if required.

Add:

- dry-run/preview;
- execution log;
- error/failure reason;
- cooldown/debounce;
- prevention of obvious loops;
- rule versioning or change history later.

### Exit criteria

“夜间有人经过 → 卫生间灯 15% → 一段时间后恢复” can be represented, validated, executed and audited as structured data.

---

### Automation implementation status — 2026-11-16

Structured v1 supports exact device capability value transitions, explicit timezone/cross-midnight time windows, and invoking an existing scene. Admin-only CRUD/enable/disable/preview, single execution with cooldown, bounded persisted logs and failure reasons are implemented. Initial discovery/repeated values/offline recovery do not execute rules; interrupted runs are not replayed. Legacy text rules remain non-executable.

Real simulator validation passed occupancy → HA WS → engine → scene → MQTT lamp at 15% → SSE feedback, with preview, disabled and offline-failure checks. The isolated test backend injects 23:30 only under NODE_ENV=test + local skip-login; production uses wall-clock time. Browser preview and execution-log display were verified. Threshold comparisons, multi-condition grammar, schedules and notification actions remain deferred.

## Phase 7 — Turn the dashboard into a real household overview

### Goal
Show information that helps a person decide whether the home needs attention.

### Work

Only show modules when backed by data:

- environment: temperature/humidity/air quality;
- energy: current power, daily/monthly consumption where supported;
- security: lock/contact/occupancy events;
- automation: recent runs and failures;
- devices needing attention: offline, low battery, filter/service due.

Change the home page priority from “many cards” to “what needs attention now”.

### Exit criteria

Every numerical/status claim on the dashboard has a defined source and freshness timestamp.

---

## Phase 8 — Expand household management beyond payments

### Goal
Make billing feel like part of “managing a home”, not an unrelated page.

### Work

- Replace hard-coded Hangzhou/provider assumptions with household configuration.
- Utility account records + due dates + reminders.
- Household assets: purchase date, warranty, manuals.
- Consumables: filters, batteries, brushes.
- Maintenance tasks: AC cleaning, filter replacement, appliance service.
- Export/backup of household records.

Do not implement actual bill payment until there is a legitimate payment/business integration need.

### Exit criteria

The product can tell a user not only what devices are doing, but what household maintenance/expense item needs attention next.

---

## Phase 9 — Add AI as a Household Copilot

### Goal
Use AI to reduce configuration and surface useful insights, not to add a generic chat box.

### Order of implementation

1. **Read-only summaries** — explain anomalies from existing data.
2. **Suggestions** — recommend a scene/automation with reasons.
3. **Natural language → structured automation draft**.
4. **User preview/confirmation**.
5. **Execution through the normal domain engine**.

Examples:

- “卧室夜间 CO₂ 连续多天偏高，是否建议新增新风自动化？”
- “这个月主卧空调耗电明显增加，主要发生在凌晨时段。”
- “以后晚上看电视时灯暗一点” → generate a previewable structured scene/rule.

### Safety rules

- AI never bypasses authorization.
- AI output must validate against schemas.
- Security-sensitive commands require explicit confirmation/policy gates.
- Every executed AI-proposed action is auditable.

### Exit criteria

AI can create a valid automation proposal without knowing provider-specific command formats.

---

## Phase 10 — Make it installable by another household

### Goal
Reach the real V0.5 product milestone: a non-developer can configure it.

### Work

- First-run onboarding.
- Create household and rooms.
- Connect provider.
- Import/map devices to rooms.
- Rename/hide devices.
- Create starter scenes.
- Health/connection status.
- Backup/restore.
- Docker-based local deployment if self-hosting is the target.
- Responsive/PWA experience; add/align a separate mobile client only when its requirements justify it.

Do not add multi-tenant SaaS complexity yet unless real users require hosted accounts.

### Exit criteria

A second household can install/configure/use the system without editing code or JSON files.

---

## Recommended immediate backlog

Do these before adding new large features:

1. Add `AGENTS.md` to the repository root.
2. Clean dependency/build reproducibility and add frontend test scripts.
3. Introduce stable `Room` IDs and remove room-name-as-ID assumptions.
4. Design `Device + Capability + DeviceState + Command` contracts.
5. Refactor current light/AC/curtain/robot UI to those contracts while still using mock data.
6. Introduce `MockProvider` behind the existing API.
7. Move fake environment/security/energy values to explicit demo fixtures or unavailable states.
8. Design data-driven `Scene` and migrate the three current scenes.
9. Migrate persistence to SQLite around the new model.
10. Only then connect one real household/provider and add realtime events.

This sequence protects the project from becoming a Xiaomi-specific UI that has to be rewritten when the first real integration arrives.
