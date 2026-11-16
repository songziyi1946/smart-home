# smart-home

#### 介绍
智能家居中控台

#### 软件架构
设备控制采用独立的领域模型与 Provider：

- `packages/contracts/devices.ts`：`Device` 元数据、`Capability`、`DeviceState`、`DeviceCommand` 和 Provider 类型契约。
- `backend/domain/devices/`：运行时校验、旧数据迁移和设备命令；`backend/domain/scenes/` 负责场景定义、执行与结果。
- `backend/providers/mock/`：MockProvider 提供设备列表、状态读取与命令执行；默认提供模拟设备。
- 首页与 VR 根据能力渲染控制，通用 UI 不包含厂商字段；当前空调只提供开关能力。

设备元数据、能力、状态、场景动作、自动化规则和执行日志按实体存入 SQLite，API 快照结构保持不变。首次启动自动迁移旧 JSON，保留 ID、顺序和状态。HA 规范化缓存持久化，重启后先标记离线，等待 Provider 确认。

API 快照中的 `devices` 为元数据与嵌套 `state` 的组合，前后端需同步更新。`PATCH /api/devices/:id` 接收 `{ "capability": "brightness", "value": 80 }` 等命令，兼容旧 `action` 命令。场景也经过 Provider 执行。MockProvider 与事务草稿绑定，校验或保存失败时不会改动已提交状态。

`SMART_HOME_DATA_DIR` 可指定隔离数据目录（同时包含业务状态和登录数据），默认仍为 `backend/data`。自动化集成测试仅使用临时目录。


#### Home Assistant 与虚拟设备

服务端 `HomeAssistantProvider` 通过 REST `/api/states` 发现实体、读取状态，通过 `/api/services/{domain}/{service}` 下发能力命令，通过 WebSocket 认证后订阅 `state_changed`。断线时缓存设备标为离线，指数退避重连后重新发现并重放同步期间事件；不会盲目重试设备命令。

后端环境变量 `HA_URL`、`HA_TOKEN` 开启接入；可选 `HA_ENTITY_PREFIX` 限定实体、`HA_ROOMS_FILE` 映射房间。Token 只在服务端内存使用，不进入业务数据库、API 快照或浏览器。仅 HA 实体 ID 保留为 Provider 路由元数据，原始 HA attributes 不透传通用 UI。

当前映射包括 power、brightness、position、cleaning、battery，以及 temperature（°C）、humidity（%）、binary、targetTemperature（°C）、hvacMode。每个 HA Entity 对应一个 Device；不在此阶段聚合物理设备或引入设备注册表。只暴露实体声明支持的控制能力；unknown/unavailable 为离线、无伪造状态。

通用 UI 组件不变。App 通过同源 SSE `/api/events` 接收服务端 WS 状态事件和本地保存后的完整快照；Cookie 保持 HttpOnly，Token 不下发，HTTP 控制响应不再覆盖 SSE 状态。传感器及目标温度/模式能力可通过 API 访问，首页环境指标与人体感应已读取这些领域状态，模拟数据明确标注，缺失或离线时显示暂无数据；目标温度/模式仍未新增控制组件。HA 状态读取以实际报告为准，服务调用成功不保证硬件已完成动作。

自定义场景可显式选择 HA 设备及能力。动作不能事务回滚，场景中途失败停止后续执行，已下发动作仍可能生效。默认场景仅在迁移时生成一次，后续完全由编辑器保存的动作列表决定。

无真实硬件时，使用 [MQTT Discovery 模拟器与完整测试说明](tools/device-simulator/README.md) 启动独立的 HA/Mosquitto 环境及八台动态虚拟设备（11个 HA 实体）。

#### 安装教程

使用 Node.js 26.13.1（`.nvmrc`）和 npm 11.20.0，两个子项目均使用 npm，提交各自的 `package-lock.json`。不要混用 Yarn/pnpm 或复制其他机器的 `node_modules`。

从项目根目录安装锁定依赖：

```sh
npm ci --prefix backend
npm ci --prefix frontend
```

#### 使用说明

在两个终端中分别启动后端和前端（从项目根目录执行）：

```sh
cd backend
npm run dev
```

```sh
cd frontend
npm run dev
```

浏览器打开 http://localhost:8000。前端将 `/api` 请求转发到端口 3101 的后端，因此两个服务都需要运行。若该端口被占用，在两个启动终端中设置同一个 `SMART_HOME_API_PORT` 后重启前后端。后端数据保存在 `backend/data/home.sqlite`，旧 JSON 仅作首次迁移输入。

可选配置：将 `.env.example` 复制为 `.env`。它不会自动加载；需要配置时，在两个启动终端中均从项目根目录执行，再启动服务：

```sh
set -a
. ./.env
set +a
```

不要提交 `.env`。`SMART_HOME_DATA_DIR` 建议填写绝对路径，切换目录会使用另一份家庭业务和登录数据。

#### 工程检查与 CI

从项目根目录执行完整检查：

```sh
npm test --prefix backend
npm run typecheck --prefix frontend
npm test --prefix frontend
npm run build --prefix frontend
```

前端使用 `tsx + node:test`，原有 `.mjs` 测试可直接导入 TypeScript，无需实验性类型剥离参数。测试入口覆盖 `src/*.test.mjs` 与 `src/vr/*.test.mjs`；新增其他目录的测试时需同步扩展入口。

`.github/workflows/ci.yml` 在 GitHub 的 push、pull request 或手动触发时执行锁定安装和上述检查。当前 origin 为 Gitee，这份工作流不会在 Gitee 自动执行；需推送到启用 Actions 的 GitHub 仓库/镜像，或在自己的 CI 中配置相同命令。尚未验证远端 CI 运行。

ESLint/格式化暂不引入：本阶段用类型检查、测试和构建作为必需检查，避免未建立统一规范时产生纯格式差异。

#### 源码分发

`node_modules`、`dist` 和本地 `.env` 不进入 Git；`.gitattributes` 也从源码归档中排除这些文件及 `backend/data` 运行数据，首次启动会使用 MockProvider 默认设备。分享已提交源码时使用：

```sh
git archive --format=zip --output=../smart-home-source.zip HEAD
```

此命令只包含 HEAD 中已提交的文件，交付前先确认需要的修改已提交。接收方解压后按上文执行 `npm ci` 和完整检查；不要直接压缩包含本地依赖、构建产物或家庭数据的整个工作目录。

#### 登录与鉴权

本地运行 `npm run dev --prefix backend` 时临时跳过登录。要恢复验证，停止该进程并运行 `npm start --prefix backend`。

首次打开页面时创建家庭，设置家庭名称、管理员用户名、显示名称和 12–128 位密码，创建后自动登录。没有默认密码，也不开放自行注册。

家庭管理员可在“我的”页面生成一次性邀请码（15 分钟内有效）。家人从登录页选择“加入家庭”，输入邀请码并创建自己的账户，无需共享管理员密码。

| 家庭身份 | 权限 |
| --- | --- |
| 家庭管理员 | 全部功能，管理自动化、邀请和移除成员 |
| 家庭成员 | 设备、场景、缴费；查看自动化配置 |
| 限时访客 | 设备和场景控制；无法读取缴费及自动化数据 |

访客访问期限可设为 1 小时、24 小时或 7 天，从接受邀请时开始计算；到期自动失效。管理员移除成员后，其已有会话立即失效。当前为单家庭模式。

所有业务 API 均校验身份和权限。会话通过 HttpOnly、SameSite=Strict Cookie 保存，有效期最多 8 小时（不超过访客访问期限），退出登录后立即失效。服务重启后需重新登录，家庭账户与未过期邀请码仍然保留。

密码继续使用随机盐和 scrypt 哈希，账号、家庭及邀请数据存入 SQLite；旧 auth.json 自动导入，数据库和备份已被 Git 忽略。首次创建家庭前，请保持服务仅供自己访问。

在 `backend` 目录执行 `npm test` 可运行鉴权、设备领域、MockProvider 和 HTTP/重启持久化测试。
前端基础测试：`npm test --prefix frontend`（从项目根目录执行）。

#### 参与贡献

1.  Fork 本仓库
2.  新建 Feat_xxx 分支
3.  提交代码
4.  新建 Pull Request


#### 特技

1.  使用 Readme\_XXX.md 来支持不同的语言，例如 Readme\_en.md, Readme\_zh.md
2.  Gitee 官方博客 [blog.gitee.com](https://blog.gitee.com)
3.  你可以 [https://gitee.com/explore](https://gitee.com/explore) 这个地址来了解 Gitee 上的优秀开源项目
4.  [GVP](https://gitee.com/gvp) 全称是 Gitee 最有价值开源项目，是综合评定出的优秀开源项目
5.  Gitee 官方提供的使用手册 [https://gitee.com/help](https://gitee.com/help)
6.  Gitee 封面人物是一档用来展示 Gitee 会员风采的栏目 [https://gitee.com/gitee-stars/](https://gitee.com/gitee-stars/)

#### SSE 状态同步

`GET /api/events` 使用现有家庭会话鉴权。每次连接（包括 Last-Event-ID 重连）发送当前完整 `snapshot`，之后由 Provider 事件或本地原子保存触发；25ms 合并突发事件，帧 ID 为进程 UUID + 单调递增序号。当前采用完整状态补同步，不保留事件历史或回放每个中间遥测。

浏览器使用原生 EventSource，服务端指定1500ms重试，15秒注释心跳；慢客户端关闭后重连补同步。每帧重新校验会话并调用原访客过滤函数。登出/移除成员即时通知连接关闭，会话到期通过定时检查关闭；前端收到 auth-expired 或重新鉴权401后回到登录。页面布局不变。

反向代理需允许流式响应，关闭缓冲并配置大于15秒的读取超时。服务端发送 `X-Accel-Buffering: no` 和 `Cache-Control: no-cache, no-transform`。

#### 数据驱动场景

首页“管理场景”支持创建、编辑、动作排序和删除；VR 快捷场景同样读取数据。管理员管理定义，成员/访客保持执行权限，服务器独立校验角色、设备和可写 Capability。访客能查看可执行场景，仅能看到自己产生的执行记录。

首次加载缺少 `scenes` 的旧 JSON 时，从现有本地设备生成回家/离家/睡眠三个定义；后续执行不再按场景 ID 分支，删除默认场景不会在重启时重新出现。新发现的 HA 设备不会被隐式加入旧场景，请在编辑器中明确添加。现有床头灯等默认行为保留，之后完全由保存的动作列表决定。

- `POST /api/scenes`：`{name,description,actions:[{deviceId,command:{capability,value}}]}`。
- `PUT /api/scenes/:id`：同上并传当前 `version`，版本冲突返回409。
- `DELETE /api/scenes/:id`：删除定义。
- `POST /api/scenes/:id`：执行并返回 `{run}`；部分失败仍返回200，须检查 `run.status` 与逐动作结果。

场景与最近50次执行记录保存在 SQLite，通过事务原子提交；每个场景最多100个动作、最多100个场景。按顺序调用 MockProvider / HomeAssistantProvider，一步失败停止，剩余步骤标为 skipped。执行期间拒绝另一场景并发启动（409）；每步前重新校验会话。编辑/删除不改变已开始执行的动作副本。

`sent` 表示 Provider 接受命令，并不代表硬件动作已完成；最终设备状态由 Provider/SSE 反馈。已下发动作无法自动回滚。服务重启后将未完成执行标为中断，对下发中动作标记结果未知，不自动重试。执行中与最终结果通过 SSE 更新首页，失败显示原因。

#### 结构化自动化

自动化页面支持创建/编辑/删除、启用/禁用及不产生设备动作的预览。规则使用 `schemaVersion: 1`，由一个 `device_state_changed` 触发器（设备、能力、可选旧值、目标值）、一个 `time_window` 条件（start/end/timeZone）和一个 `run_scene` 动作组成。仅支持精确值变化，不解释旧文本规则，也不执行任意脚本或直接操作 Provider。

只有管理员可以创建、修改、启停、删除或预览；成员可查看，访客的 HTTP/SSE 快照不包含规则及自动化日志。保存后的规则以创建管理员的有效权限自主运行，不依赖其登录会话持续在线；执行每一步仍校验规则启用/版本和管理员有效性。禁用或修改不会回滚已下发动作，但会停止剩余动作。

时间按规则指定的 IANA 时区判定，起点包含、终点不包含；支持22:00–06:30这类跨午夜窗口，不允许起止相同。首次发现、重复值、unknown/离线恢复只建立基线，不触发动作；默认30秒冷却（1–3600可配），规则单实例运行，场景忙时记录失败而不重试排队。

规则及最近100条 running/completed/failed/skipped 日志通过事务保存到 SQLite；日志包含触发前后值、判定时间、关联场景执行记录及失败原因，通过 SSE 更新页面。服务重启会标记未完成记录为中断，不重试硬件命令。旧 `rules` 描述性示例仅保留兼容数据，不进入新引擎，欢迎语配置不再生成可执行联动。

API：`POST /api/automations`，`PUT /api/automations/:id`（携带version），`PATCH /api/automations/:id`（enabled），`DELETE /api/automations/:id`。`POST /api/automations/preview` 接收 `{rule,event:{from,to},at?}`；at 仅影响预览，绝不改变实际引擎时钟。预览不保存日志、不调用场景，还会说明实际执行时仍需检查授权、冷却、并发和设备状态。

模拟器 `test:e2e` 会创建15%亮度场景，注入人体感应并验证真实 HA/MQTT 执行反馈及 SSE 日志。为了在白天可重复验收，测试进程使用 `SMART_HOME_AUTOMATION_TEST_TIME=2026-11-16T23:30:00+08:00`；仅同时满足 `NODE_ENV=test` 和本机 `--skip-login` 时允许此配置，否则启动拒绝。正式服务使用实际时间，前端和设备事件均不能覆盖它。

#### SQLite 持久化与旧数据迁移

使用 Node.js 26.13.1 / npm 11.20.0 和内置 `node:sqlite`，不增加原生 npm 模块。仓储位于 `backend/infrastructure/sqlite-store.mjs`，schema 版本为1（`PRAGMA user_version`）。

首次启动在 `SMART_HOME_DATA_DIR`（默认 `backend/data`）创建 `home.sqlite`；若有 `state.json` / `auth.json`，先保存内容摘要命名的 `.pre-sqlite-*.bak` 备份，原文件不改写。数据库与备份权限0600。在同一事务中导入业务及账号数据并写入迁移标记，保留设备 ID、动作顺序、规则版本、日志、费用和欢迎语。

成功后始终以 SQLite 为准，不因旧 JSON 仍存在或被编辑而重复导入。损坏 JSON、无效数据或更高版本 schema 会明确失败，不会清空数据后静默启动。迁移失败可修复输入后重试。

设备、状态、场景、规则、日志、账单、家庭、用户、邀请各自存表；能力和场景动作独立存行，规则与日志的版本化复杂内容使用 JSON 列，未知旧配置在 settings 中保留。不是把整份状态作为单个 JSON blob 存库。

使用 WAL、foreign_keys、busy_timeout 和 synchronous=FULL。业务写入成功后才更新内存并发布 SSE，事务失败回滚。仍按单个后端进程管理一个家庭；版本计数拒绝过期进程的业务/账号写入，避免覆盖另一进程的数据。不要让旧 JSON 后端与新后端同时服务同一目录。

重启保留执行日志，将未完成执行标为中断/结果未知，不重放硬件命令。HA 缓存与 lastSeenAt 保留，但在线状态重新确认。会话仍在内存，重启需登录；密码哈希、家庭与邀请保留。HA Token 不入库。

备份时停止后端，再复制整个数据目录（含 home.sqlite 和可能存在的 -wal/-shm 文件），恢复也在停机状态下进行。不要只复制正在写入的主文件。旧 JSON 备份只代表迁移时刻，不能用来恢复迁移后的新增操作。
