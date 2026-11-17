# AGENTS.md

## 1. Purpose

This repository is evolving from a personal Xiaomi-oriented smart-home dashboard into a reusable **household digital hub / Home OS**.

The product goal is **not** to clone Mi Home or add more device-control buttons. The product should help a household understand and automate daily life across:

- spaces and rooms;
- devices and device capabilities;
- scenes and automations;
- environment, energy and security status;
- household members and guest access;
- bills, maintenance and household assets;
- later, AI-assisted insights and automation suggestions.

A good change should reduce the amount of manual control a user needs, not merely add another control surface.

## 2. Repository snapshot

### Frontend

- React 18 + TypeScript + Vite
- Arco Design
- Lucide icons
- Three.js for the 3D/VR space view
- Current navigation is hash-based and implemented locally in `frontend/src/App.tsx` and `frontend/src/layout/`.

### Backend

- Node.js ESM
- Express 5
- Zod input validation
- SQLite persistence in `backend/data/home.sqlite`, repository in `backend/infrastructure/sqlite-store.mjs`; one-time transactional imports of state.json and auth.json.
- Authentication and household membership in `backend/auth.mjs`

### Current implemented domains

- household setup, login and logout;
- admin/member/guest roles;
- one-time household invitations;
- basic devices: light, AC, curtain and robot vacuum;
- data-driven scenes with editable home/away/sleep defaults and custom scene CRUD/execution;
- automation display/configuration and greeting simulation;
- utility accounts and expense records;
- 3D/VR room view.

### Important current limitations

- The uploaded repository contains `frontend` and `backend`; no separate mobile package is present. Do not invent or silently modify a mobile architecture that is not in the repository.
- Device metadata, capabilities, state and commands are separated; shared client contracts live in `packages/contracts/devices.ts` and backend validation in `backend/domain/devices/`.
- Device data is provided by `backend/providers/mock/MockProvider` (implemented in `index.mjs`); an optional server-side HomeAssistantProvider is available through HA_URL/HA_TOKEN. Tokens must never reach frontend code, snapshots, logs or business persistence. Legacy `kind` records migrate on load and persist on the next successful commit.
- Scenes are persisted ordered capability actions in `backend/domain/scenes/`; admin-only CRUD, existing member/guest execution, stop-on-failure results and restart interruption handling.
- Structured automation v1 lives in `backend/domain/automations/`: device value transition + timezone time window + existing scene. Admin-only management/preview, bounded persisted logs, cooldown and reconnect baseline suppression. Legacy text rules never execute.
- Home environment and occupancy read normalized online sensor telemetry with explicit simulator/mock source labels. Missing/offline telemetry and unconnected security/energy values show unavailable; no fabricated healthy state or estimated baseline power is shown.
- Billing contains location/provider assumptions such as Hangzhou and fixed official-channel links.
- Business/auth data and normalized Provider cache persist in SQLite. Public API snapshots remain unchanged; sessions remain in memory.

## 3. Product principles

All agents working in this repository must preserve the following principles.

### 3.1 Household-first, not vendor-first

The UI and domain model must describe household concepts. Xiaomi, Matter, Home Assistant or another ecosystem is an integration detail.

Never make Xiaomi-specific identifiers, MIoT property names or provider response shapes the core frontend model.

Preferred direction:

```text
Provider / Adapter
      ↓
Normalization
      ↓
Household Domain
      ↓
API / Events
      ↓
Web / Mobile UI
```

### 3.2 Capabilities over device kinds

Do not continue expanding code such as:

```ts
if (device.kind === 'light') ...
else if (device.kind === 'ac') ...
```

The target model is a device with one or more capabilities, for example:

```ts
Device {
  id
  householdId
  roomId
  providerId
  providerDeviceId
  name
  online
  capabilities
}
```

Typical capabilities include:

- `power`
- `brightness`
- `colorTemperature`
- `temperature`
- `humidity`
- `airQuality`
- `position`
- `battery`
- `powerMeter`
- `lock`
- `occupancy`
- `cleaning`

Provider-specific data may be retained as metadata, but product behavior must use normalized capabilities.

### 3.3 Separate metadata, current state and commands

Do not mix these concepts in one object indefinitely:

- device metadata: name, room, provider, model;
- current state/telemetry: on/off, temperature, battery, online state;
- supported commands: power, set brightness, open curtain, start cleaning;
- event history: state changes, sensor events, automation runs.

External device state can change without this application initiating a mutation. The architecture must therefore be able to receive provider events and update current state independently.

### 3.4 Never present demo data as live data

Values that are not backed by a real source must be explicitly identified as demo/estimated data or replaced with an unavailable state.

This especially applies to:

- temperature and humidity;
- PM2.5 and AQI;
- security/armed state;
- door-lock state;
- device online status;
- real-time power and energy.

Do not add new fake telemetry merely to make a dashboard look complete.

### 3.5 Scenes are user-facing intentions

Scenes should represent lifestyle intentions such as:

- 回家 / Arrive home
- 离家 / Away
- 睡眠 / Sleep
- 阅读 / Reading
- 观影 / Movie
- 聚餐 / Dinner
- 清洁 / Cleaning

A scene must become data rather than frontend/backend hard-coded branches. A scene contains ordered device actions and can later be reused by automations.

### 3.6 Automations must become executable structured rules

Do not model a future automation only as free-form `trigger`, `condition`, and `action` strings.

The target model should be structured and versioned, conceptually:

```ts
AutomationRule {
  id
  name
  enabled
  triggers[]
  conditions[]
  actions[]
  executionPolicy
  createdBy
  lastRunAt
}
```

Every automation change should eventually support:

- schema validation;
- dry-run/preview;
- execution logs;
- failure reason;
- idempotency where applicable;
- enable/disable;
- clear human-readable explanation.

### 3.7 AI proposes; the domain engine executes

AI must not directly mutate arbitrary device/provider state.

The safe target flow is:

```text
Natural-language request / insight
        ↓
AI proposes a structured scene or automation
        ↓
Schema validation + policy checks
        ↓
Human preview/confirmation when appropriate
        ↓
Existing domain command/automation engine executes it
        ↓
Audit log
```

Security-sensitive actions such as unlocking doors must never be silently executed from an LLM response.

### 3.8 Local-first privacy

This product manages intimate household data. Prefer local storage/execution where practical and minimize collection.

Never commit or log:

- passwords or password hashes;
- session cookies/tokens;
- Xiaomi/Home Assistant/provider credentials;
- invitation secrets;
- raw utility credentials or other household secrets.

Utility account numbers are currently stored locally and only masked in API snapshots. Before productization, treat account identifiers as sensitive data and design appropriate encrypted-at-rest or reduced-data storage.

### 3.9 Do not couple commercial product behavior to unverified third-party APIs

For personal experiments, adapters may be built against locally controlled or explicitly permitted integrations.

Before shipping or monetizing an integration, verify the provider's current API terms and license. In particular, do not copy or embed Xiaomi Home Assistant integration code/cloud APIs into this product as a commercial shortcut unless the applicable license/authorization explicitly permits it.

## 4. Target domain boundaries

Prefer growing the backend toward these boundaries instead of keeping all logic in `server.mjs`:

```text
backend/
  app/
    routes/
    middleware/
  domain/
    household/
    rooms/
    devices/
    scenes/
    automations/
    events/
    billing/
    maintenance/
  providers/
    mock/
    home-assistant/
    matter/          # future
  infrastructure/
    persistence/
    event-bus/
  auth/
```

Do not perform a large rewrite only to match this tree. Move code incrementally when a feature creates a real boundary.

A future shared contract package is encouraged when API complexity grows:

```text
packages/contracts/
```

It should contain versioned schemas/types shared by clients and backend. Zod is already used and is a good basis for runtime contracts.

## 5. Provider contract

When real-device integration begins, add a provider abstraction before adding provider-specific routes to the UI.

A provider should conceptually support:

```ts
interface DeviceProvider {
  discoverOrListDevices(): Promise<ProviderDevice[]>;
  getDeviceState(deviceId: string): Promise<ProviderDeviceState>;
  executeCommand(deviceId: string, command: ProviderCommand): Promise<void>;
  subscribe?(handler: (event: ProviderEvent) => void): Promise<() => void>;
}
```

The application layer must normalize provider devices/capabilities into the product's domain model.

Keep `MockProvider` as a first-class implementation. It is useful for development, automated tests, screenshots and demos even after real providers exist.

## 6. Persistence direction

SQLite is now the owning persistence source. Legacy state.json/auth.json are imported once with protected backups, never used as a live fallback.

Before adding substantial real household history or external integrations, migrate persistent business data to a small real database. Prefer SQLite for a local/self-hosted first product; keep the repository/service boundary database-agnostic enough to move to PostgreSQL later if a hosted multi-household service is justified.

Do not migrate databases merely to appear production-ready. Migrate when implementing the normalized device/scene/automation/event model.

Minimum future entities should include:

- households;
- users/memberships;
- rooms;
- providers/connections;
- devices;
- device capabilities;
- scenes and scene actions;
- automation rules;
- events/automation runs;
- utility accounts/expenses;
- maintenance items.

## 7. API and realtime rules

### Current behavior

Many mutations return the entire state snapshot. This is simple and acceptable for the current prototype.

### Target behavior

As provider-backed devices are introduced:

- use resource-oriented endpoints;
- make device commands explicit;
- return the changed resource/command result rather than relying on a full global snapshot forever;
- introduce Server-Sent Events or WebSocket only when external state changes require realtime updates;
- give events stable IDs/timestamps and preserve ordering semantics;
- handle offline and stale devices explicitly.

Do not add realtime infrastructure before there is a provider/event source that needs it.

## 8. Frontend rules

- Keep UI components provider-agnostic.
- Render controls from normalized capabilities where practical.
- Keep room IDs/data separate from display labels; do not continue relying on Chinese room names as long-term identifiers.
- Do not hard-code city-specific household behavior in generic components.
- Preserve lazy-loading for heavyweight Three.js/VR code.
- Do not make the 3D view a dependency for basic household control.
- Prefer clear empty/offline/unsupported states over fake data.
- Keep desktop dashboard quality, but new product flows must also be usable on narrow/mobile layouts.
- If a mobile client is later added, reuse domain/API contracts instead of duplicating business logic.

## 9. Backend and security rules

Preserve the good security properties already present:

- password hashing with scrypt + random salt;
- HttpOnly session cookie;
- SameSite cookie policy;
- origin validation for state-changing requests;
- server-side authorization;
- guest data filtering;
- input validation with Zod;
- immediate member-session invalidation after removal;
- transactional SQLite writes; update memory and publish SSE only after commit.

When changing authorization, test both allowed and denied paths. UI hiding is not authorization.

Do not weaken auth for convenience. `--skip-login` must remain local-development-only.

## 10. Testing and validation

Before considering a change complete, run the smallest relevant checks plus the repository baseline.

### Backend

```bash
npm test --prefix backend
```

At the time this file was authored, the backend auth suite contains 7 passing tests.

### Frontend type check

```bash
npm run typecheck --prefix frontend
```

### Frontend tests

```bash
npm test --prefix frontend
```

Simulator tests: `npm test --prefix tools/device-simulator`; real HA/MQTT lab instructions are in `tools/device-simulator/README.md`.

Tests use `tsx + node:test` with explicit TypeScript support. The current entry covers `src/*.test.mjs` and `src/vr/*.test.mjs`; extend it when adding tests in other directories.

Use npm for both packages, commit both `package-lock.json` files, and install with `npm ci --prefix backend` / `npm ci --prefix frontend`. The `.nvmrc` pins Node.js 24.18.0, which bundles npm 11.16.0. Do not reintroduce Yarn/pnpm lockfiles.

CI is defined in `.github/workflows/ci.yml`. It runs on GitHub only; the current Gitee origin needs a GitHub mirror with Actions enabled or equivalent CI configured separately. `.env.example` documents optional runtime configuration; `.env` is explicitly loaded by the shell as described in README.

### Frontend production build

```bash
npm run build --prefix frontend
```

If Rollup reports a missing platform-specific optional package after the repository was copied between operating systems, do not patch application code. Remove copied `node_modules` and reinstall dependencies on the current platform.

Never commit or distribute `node_modules`. `dist` should remain generated output unless there is a deliberate deployment reason to package it.

## 11. Change workflow for coding agents

For non-trivial work:

1. Read the relevant domain/UI files before editing.
2. State the user-visible behavior being changed.
3. Identify whether the change belongs to product domain, provider integration, persistence, API, or presentation.
4. Prefer the smallest refactor that creates the required boundary.
5. Add/adjust validation and authorization at the server boundary.
6. Add tests for new domain behavior, especially negative paths.
7. Run typecheck/tests/build as applicable.
8. Report what was verified and any environment-only failure separately from code failures.

Do not perform unrelated visual redesigns, dependency upgrades or architecture rewrites in the same change unless required.

## 12. Definition of done

A feature is not done merely because a page renders.

For a device/scene/automation feature, done normally means:

- domain model is explicit;
- server input is validated;
- authorization is enforced server-side;
- UI handles loading/error/empty/offline states;
- provider-specific details do not leak into generic UI;
- persisted data survives restart when it is meant to;
- tests cover core behavior;
- no secret is committed/logged;
- demo values are clearly marked or removed;
- the README/AGENTS documentation is updated if startup commands or architecture assumptions changed.

## 13. Near-term priority order

Unless the user explicitly asks otherwise, prioritize work in this order:

1. engineering baseline and reproducible tests/builds;
2. normalized household/room/device/capability model;
3. persistence migration and backend modularization;
4. provider abstraction + `MockProvider` + one real personal integration;
5. realtime state/event flow;
6. data-driven scenes;
7. executable automation engine + run logs;
8. real environment/energy/security dashboards;
9. household maintenance/billing improvements;
10. AI insights and natural-language automation proposals;
11. broader providers, Matter support and product onboarding;
12. hosted/multi-household scale only after real user demand exists.

## Realtime state transport

The frontend consumes `/api/events` through EventSource; do not reintroduce periodic `/api/state` polling or apply mutation response snapshots over the stream. `backend/app/state-stream.mjs` sends full current snapshots on every connection/reconnection and coalesces Provider/local commit notifications. This is current-state resync, not historical event replay. Preserve per-frame session validation and guest filtering, and immediate connection invalidation on logout/member removal.

## Frontend experience boundaries

- Mobile (<768px) has its own home/more views in `frontend/src/mobile/Views.tsx`; do not replace them with vertically stacked desktop dashboard panels.
- `styles/tokens.css` owns shared semantic colors and Arco theme mapping; `styles/shell.css` owns app navigation/connection presentation.
- Reuse `deviceControls/model.ts` for capability-based command dispatch and summaries; keep real device state sourced from SSE.
- Room browsing groups existing roomId values; this is not room CRUD. Favorites are browser-local IDs scoped by household/user, not server configuration.
- Preserve legacy hash routes, guest restrictions, mobile environment visibility, explicit drawer close/back behavior, and cache labels during connection loss.

- Desktop home is composed in `frontend/src/home/index.tsx`; desktop-only directory/cards/selectors live in `frontend/src/desktop/`. Keep desktop attention and mobile attention consistent through shared state selectors.
- `#devices` provides read/control/filter/favorite workflows only. Do not imply device rename, room assignment or online connection configuration is persisted until those APIs exist.
