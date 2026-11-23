# 开发与部署指南

[返回项目首页](../README.md)

本文面向开发者和自行部署的用户，涵盖开发启动、Home Assistant 接入、接口与数据备份。

## 软件架构

设备控制采用独立的领域模型与 Provider：

- `packages/contracts/devices.ts`：`Device` 元数据、`Capability`、`DeviceState`、`DeviceCommand` 和 Provider 类型契约。
- `backend/domain/devices/`：运行时校验、旧数据迁移和设备命令；`backend/domain/scenes/` 负责场景定义、执行与结果。
- `backend/providers/mock/`：MockProvider 提供设备列表、状态读取与命令执行；默认提供模拟设备。
- 首页与 VR 根据能力渲染控制，通用 UI 不包含厂商字段；内置模拟空调只提供开关能力。

设备元数据、能力、状态、场景动作、自动化规则和执行日志按实体存入 SQLite，API 快照结构保持不变。首次启动自动迁移旧 JSON，保留 ID、顺序和状态。HA 规范化缓存持久化，重启后先标记离线，等待 Provider 确认。

API 快照中的 `devices` 为元数据与嵌套 `state` 的组合，前后端需同步更新。`PATCH /api/devices/:id` 接收 `{ "capability": "brightness", "value": 80 }` 等命令，兼容旧 `action` 命令。场景也经过 Provider 执行。MockProvider 与事务草稿绑定，校验或保存失败时不会改动已提交状态。

`SMART_HOME_DATA_DIR` 可指定隔离数据目录（同时包含业务状态和登录数据），默认仍为 `backend/data`。自动化集成测试仅使用临时目录。

## Home Assistant 与虚拟设备

服务端 `HomeAssistantProvider` 通过 REST `/api/states` 发现实体、读取状态，通过 `/api/services/{domain}/{service}` 下发能力命令，通过 WebSocket 认证后订阅 `state_changed`。断线时缓存设备标为离线，指数退避重连后重新发现并重放同步期间事件；不会盲目重试设备命令。

后端环境变量 `HA_URL`、`HA_TOKEN` 开启接入；可选 `HA_ENTITY_PREFIX` 限定实体、`HA_ROOMS_FILE` 映射房间。Token 只在服务端内存使用，不进入业务数据库、API 快照或浏览器。仅 HA 实体 ID 保留为 Provider 路由元数据，原始 HA attributes 不透传通用 UI。

当前映射包括 power、brightness、position、cleaning、battery，以及 temperature（°C）、humidity（%）、binary、targetTemperature（°C）、hvacMode。每个 HA Entity 对应一个 Device；不在此阶段聚合物理设备或引入设备注册表。只暴露实体声明支持的控制能力；unknown/unavailable 为离线、无伪造状态。

App 通过同源 SSE `/api/events` 接收服务端 WS 状态事件和本地保存后的完整快照；Cookie 保持 HttpOnly，Token 不下发，HTTP 控制响应不再覆盖 SSE 状态。首页从设备读取环境指标与人体感应，模拟数据明确标注，缺失或离线时显示暂无数据。空调目标温度和模式可在设备详情中调整，具体取决于设备支持的功能。HA 状态读取以实际报告为准，服务调用成功不保证硬件已完成动作。

自定义场景可显式选择 HA 设备及能力。动作不能事务回滚，场景中途失败停止后续执行，已下发动作仍可能生效。默认场景仅在迁移时生成一次，后续完全由编辑器保存的动作列表决定。

无真实硬件时，使用 [MQTT Discovery 模拟器与完整测试说明](../tools/device-simulator/README.md) 启动独立的 HA/Mosquitto 环境及八台动态虚拟设备（11个 HA 实体）。

## 安装教程

使用 Node.js 24.22.3（`.nvmrc`）和随附的 npm 11.19.1。两个子项目均使用 npm，提交各自的 `package-lock.json`。不要混用 Yarn/pnpm 或复制其他机器的 `node_modules`。

生产环境保持 Node 24 LTS 分支，定期验证并同步最新安全补丁到 `.nvmrc`、Dockerfile、各包的 engines/packageManager 和 edgeone.json。当前 engines 限定为 `>=24.22.3 <25`，避免未经验证的主版本进入部署。Node 20 已结束官方维护，Node 22 的维护期限更短；不以降低主版本作为稳定性或安全性的默认方案。

从项目根目录安装锁定依赖：

```sh
npm ci --prefix backend
npm ci --prefix frontend
```

## 启动方式与配置

只在本机使用时，可以[下载体验包](../README.md#在电脑上试用)，也可以[从源码构建](../README.md#从源码运行)一次，由后端直接提供网页。若 3101 端口被占用，在启动前设置 `SMART_HOME_API_PORT`，并在浏览器访问新端口。例如在 macOS/Linux 中执行 `export SMART_HOME_API_PORT=3102`，在 PowerShell 中执行 `$env:SMART_HOME_API_PORT = '3102'`。

开发时，在两个终端中分别启动后端和前端（从项目根目录执行）：

```sh
cd backend
npm run dev
```

```sh
cd frontend
npm run dev
```

浏览器打开 http://localhost:8000。默认前端将 `/api` 请求转发到本机端口 3101 的后端，因此本地开发两个服务都需要运行。若该端口被占用，在两个启动终端中设置同一个 `SMART_HOME_API_PORT` 后重启前后端。后端数据保存在 `backend/data/home.sqlite`，旧 JSON 仅作首次迁移输入。

### 本地前端连接服务器后端

复制 `frontend/.env.example` 为 `frontend/.env.local`，将 `SMART_HOME_API_URL` 设置为服务器公开的 HTTPS 地址，例如：

```dotenv
SMART_HOME_API_URL=https://your-home.example.com
```

填写站点根地址，不附加 `/api`，不放账号、密码或 Token。之后从项目根目录运行 `npm run dev --prefix frontend` 即可，无需启动本地后端或 SSH 隧道。Vite 自动加载该文件；修改后需重启前端。环境变量优先于文件；地址为空时恢复本地后端，使用 `SMART_HOME_API_PORT`（默认 3101）。`.env.local` 已被 Git 忽略。

用 Chrome 访问 http://localhost:8000，并用服务器上的账号重新登录。API 和 SSE 均通过本地 Vite 转发，页面操作会修改服务器上的家庭数据。远程代理先校验本地请求来源，再调整上游 Host/Origin；服务器授权、Cookie 安全属性和 TLS 证书校验保持启用。生产环境的 Secure Cookie 在 Chrome 的 localhost 上可用；Safari 需要本地 HTTPS，不能依赖这一例外（[浏览器说明](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies)）。服务器地址必须能从本机直接访问，仅监听服务器回环地址的端口不能直接填入。

该配置只用于 Vite 开发代理，不改变生产构建的同源 `/api` 路径。使用 [Vite 环境配置](https://vite.dev/config/) 加载前端目录的环境文件；下面的根目录 `.env` 仍需按说明手动加载。

可选配置：将 [`.env.example`](../.env.example) 复制为 `.env` 并填写需要的配置，例如接入 Home Assistant 所需的地址和 Token。它不会自动加载；在 macOS/Linux 中，从项目根目录执行以下命令再启动后端。开发模式如果修改了后端端口，启动前端的终端也要设置相同的端口。

```sh
set -a
. ./.env
set +a
```

PowerShell 可用 `$env:变量名 = '值'` 在启动终端设置各项配置。不要提交 `.env`。`SMART_HOME_DATA_DIR` 建议填写绝对路径，切换目录会使用另一份家庭业务和登录数据。

## 工程检查与 CI

从项目根目录执行完整检查：

```sh
npm test --prefix backend
npm run typecheck --prefix frontend
npm test --prefix frontend
npm run build --prefix frontend
```

前端使用 `tsx + node:test`，原有 `.mjs` 测试可直接导入 TypeScript，无需实验性类型剥离参数。测试入口覆盖 `src/*.test.mjs` 与 `src/vr/*.test.mjs`；新增其他目录的测试时需同步扩展入口。

`.github/workflows/ci.yml` 在 GitHub 的 push、pull request 或手动触发时执行锁定安装和上述检查。在启用 Actions 的 GitHub 仓库中运行；其他托管平台可在自己的 CI 中配置相同命令。

ESLint/格式化暂不引入：本阶段用类型检查、测试和构建作为必需检查，避免未建立统一规范时产生纯格式差异。

## 源码分发

`node_modules`、`dist` 和本地 `.env` 不进入 Git；`.gitattributes` 也从源码归档中排除这些文件及 `backend/data` 运行数据，首次启动会使用 MockProvider 默认设备。分享已提交源码时使用：

```sh
git archive --format=zip --output=../smart-home-source.zip HEAD
```

此命令只包含 HEAD 中已提交的文件，交付前先确认需要的修改已提交。接收方解压后可按[源码启动步骤](../README.md#从源码运行)运行；不要直接压缩包含本地依赖、构建产物或家庭数据的整个工作目录。

在 macOS 或 Linux 上用项目指定的 Node.js 和 npm 运行 `bash scripts/experience/package.sh`，可从当前提交生成 GitHub Releases 的三个体验包，输出到 `dist/experience`。包中包含前端构建产物、打包后的后端、第三方许可和经 SHA-256 校验的 Node.js 官方运行时。

## 登录与鉴权

本地运行 `npm run dev --prefix backend` 时临时跳过登录。要恢复验证，停止该进程并运行 `npm start --prefix backend`。

首次打开页面时创建家庭，设置家庭名称、管理员用户名、显示名称和 8–32 位密码，创建后自动登录。没有默认密码，也不开放自行注册。

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

## SSE 状态同步

`GET /api/events` 使用现有家庭会话鉴权。每次连接（包括 Last-Event-ID 重连）发送当前完整 `snapshot`，之后由 Provider 事件或本地原子保存触发；25ms 合并突发事件，帧 ID 为进程 UUID + 单调递增序号。当前采用完整状态补同步，不保留事件历史或回放每个中间遥测。

浏览器使用原生 EventSource，服务端指定1500ms重试，15秒注释心跳；慢客户端关闭后重连补同步。每帧重新校验会话并调用原访客过滤函数。登出/移除成员即时通知连接关闭，会话到期通过定时检查关闭；前端收到 auth-expired 或重新鉴权401后回到登录。

反向代理需允许流式响应，关闭缓冲并配置大于15秒的读取超时。服务端发送 `X-Accel-Buffering: no` 和 `Cache-Control: no-cache, no-transform`。

开发服务器为 `/api/events` 使用独立长连接代理，不套用普通 `/api` 的5秒超时；任一侧断开会清理另一侧连接，确保浏览器能收到断线并重连。`frontend/src/devProxy.test.mjs` 通过真实 Vite 代理验证空闲超过5秒后的状态推送、后端异常断开、重连补同步及订阅清理。若出现“命令成功但按钮要刷新才更新”，需要同时检查开发代理路径，不能只验证直连后端，也不应以恢复轮询或覆盖命令响应快照来掩盖问题。

## 数据驱动场景

首页“管理场景”支持创建、编辑、动作排序和删除；VR 快捷场景同样读取数据。管理员管理定义，成员/访客保持执行权限，服务器独立校验角色、设备和可写 Capability。访客能查看可执行场景，仅能看到自己产生的执行记录。

首次加载缺少 `scenes` 的旧 JSON 时，从现有本地设备生成回家/离家/睡眠三个定义；后续执行不再按场景 ID 分支，删除默认场景不会在重启时重新出现。新发现的 HA 设备不会被隐式加入旧场景，请在编辑器中明确添加。现有床头灯等默认行为保留，之后完全由保存的动作列表决定。

- `POST /api/scenes`：`{name,description,actions:[{deviceId,command:{capability,value}}]}`。
- `PUT /api/scenes/:id`：同上并传当前 `version`，版本冲突返回409。
- `DELETE /api/scenes/:id`：删除定义。
- `POST /api/scenes/:id`：执行并返回 `{run}`；部分失败仍返回200，须检查 `run.status` 与逐动作结果。

场景与最近50次执行记录保存在 SQLite，通过事务原子提交；每个场景最多100个动作、最多100个场景。按顺序调用 MockProvider / HomeAssistantProvider，一步失败停止，剩余步骤标为 skipped。执行期间拒绝另一场景并发启动（409）；每步前重新校验会话。编辑/删除不改变已开始执行的动作副本。

`sent` 表示 Provider 接受命令，并不代表硬件动作已完成；最终设备状态由 Provider/SSE 反馈。已下发动作无法自动回滚。服务重启后将未完成执行标为中断，对下发中动作标记结果未知，不自动重试。执行中与最终结果通过 SSE 更新首页，失败显示原因。

## 结构化自动化

自动化页面支持创建/编辑/删除、启用/禁用及不产生设备动作的预览。规则使用 `schemaVersion: 1`，由一个 `device_state_changed` 触发器（设备、能力、可选旧值、目标值）、一个 `time_window` 条件（start/end/timeZone）和一个 `run_scene` 动作组成。仅支持精确值变化，不解释旧文本规则，也不执行任意脚本或直接操作 Provider。

只有管理员可以创建、修改、启停、删除或预览；成员可查看，访客的 HTTP/SSE 快照不包含规则及自动化日志。保存后的规则以创建管理员的有效权限自主运行，不依赖其登录会话持续在线；执行每一步仍校验规则启用/版本和管理员有效性。禁用或修改不会回滚已下发动作，但会停止剩余动作。

时间按规则指定的 IANA 时区判定，起点包含、终点不包含；支持22:00–06:30这类跨午夜窗口，不允许起止相同。首次发现、重复值、unknown/离线恢复只建立基线，不触发动作；默认30秒冷却（1–3600可配），规则单实例运行，场景忙时记录失败而不重试排队。

规则及最近100条 running/completed/failed/skipped 日志通过事务保存到 SQLite；日志包含触发前后值、判定时间、关联场景执行记录及失败原因，通过 SSE 更新页面。服务重启会标记未完成记录为中断，不重试硬件命令。旧 `rules` 描述性示例仅保留兼容数据，不进入新引擎，欢迎语配置不再生成可执行联动。

API：`POST /api/automations`，`PUT /api/automations/:id`（携带version），`PATCH /api/automations/:id`（enabled），`DELETE /api/automations/:id`。`POST /api/automations/preview` 接收 `{rule,event:{from,to},at?}`；at 仅影响预览，绝不改变实际引擎时钟。预览不保存日志、不调用场景，还会说明实际执行时仍需检查授权、冷却、并发和设备状态。

模拟器 `test:e2e` 会创建15%亮度场景，注入人体感应并验证真实 HA/MQTT 执行反馈及 SSE 日志。为了在白天可重复验收，测试进程使用 `SMART_HOME_AUTOMATION_TEST_TIME=2026-11-16T23:30:00+08:00`；仅同时满足 `NODE_ENV=test` 和本机 `--skip-login` 时允许此配置，否则启动拒绝。正式服务使用实际时间，前端和设备事件均不能覆盖它。

## SQLite 持久化与旧数据迁移

SQLite 仓储使用 Node.js 内置的 `node:sqlite`，无需额外安装原生 npm 模块。仓储位于 `backend/infrastructure/sqlite-store.mjs`，schema 版本为2（`PRAGMA user_version`）。

首次启动在 `SMART_HOME_DATA_DIR`（默认 `backend/data`）创建 `home.sqlite`；若只有旧 `state.json` / `auth.json`，先保存 `.pre-sqlite-*.bak.enc` 加密备份，事务导入并校验后移除旧明文源文件。失败不会删除源文件；提交后清理被中断会在下次启动续办。数据库与备份权限0600，数据目录（包括已有目录）收紧为0700。保留设备 ID、动作顺序、规则版本、日志、费用和欢迎语。已有未加密 schema v1 数据库不会直接启动，必须先按下文停服迁移。

成功后始终以 SQLite 为准，不重复导入旧 JSON。损坏 JSON、错误密钥、密文篡改或更高版本 schema 会明确失败，不会清空数据或回退到明文。若已导入的源文件被重新放回且内容不同，拒绝自动删除，需部署者先安全归档。

设备、状态、场景、规则、日志、账单、家庭、用户、邀请各自存表；能力和场景动作独立存行，规则与日志的版本化复杂内容使用 JSON 列，未知旧配置在 settings 中保留。不是把整份状态作为单个 JSON blob 存库。

使用 WAL、foreign_keys、busy_timeout 和 synchronous=FULL。业务写入成功后才更新内存并发布 SSE，事务失败回滚。仍按单个后端进程管理一个家庭；版本计数拒绝过期进程的业务/账号写入，避免覆盖另一进程的数据。不要让旧 JSON 后端与新后端同时服务同一目录。

重启保留执行日志，将未完成执行标为中断/结果未知，不重放硬件命令。HA 缓存与 lastSeenAt 保留，但在线状态重新确认。会话仍在内存，重启需登录；密码哈希、家庭与邀请保留。HA Token 不入库。

数据库各表的业务/认证 JSON payload 及场景命令使用 AES-256-GCM 加密，每次写入生成独立随机 nonce，AAD 绑定表名、主键或动作位置，防止密文跨记录替换。WAL 和临时 SQL 数据也只包含密文业务字段；表结构、关联 ID、能力名称、记录数量及修订号仍可见，这不是 SQLCipher 的整文件加密。加密实现使用 [Node.js crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html)。物理磁盘旧块及云盘历史快照不受本次迁移的安全擦除保证，需通过加密磁盘/快照生命周期控制处理。

密钥为32随机字节，存于数据目录之外的独立0600文件（64位十六进制文本），通过 `SMART_HOME_DATA_KEY_FILE` 指定。生产或 https 缺少此配置会拒绝启动；开发环境的新数据目录自动生成同级 `<数据目录>.key` 文件。已有数据库丢失密钥时不会生成替代密钥。不要把密钥与数据/备份一同上传或打包，密钥丢失无法恢复，需在密码管理器或独立受控位置保留恢复副本。

后端启动和维护操作共享独立 SQLite 排他锁，阻止维护期间启动第二个服务；锁由操作系统在进程退出/崩溃时释放。备份需停服，使用下文工具生成经过认证加密的 `.homeos.enc` 文件；恢复只写入一个尚不存在的新目录，不覆盖现有家庭。旧 JSON 的 `.bak.enc` 只是原始导入材料，不代表当前完整家庭备份。

## 桌面与移动端体验

共享设计基础位于 `frontend/src/styles/tokens.css`（浅/深色、语义色、字体、间距、圆角、动效与 Arco 映射）和 `styles/shell.css`（导航、连接/缓存提示、加载与响应式框架）。断点为手机 `<768px`、平板 `768–1199px`、桌面 `>=1200px`。旧 hash 地址保持兼容，新增 `#rooms`、`#scenes` 和 `#account`。

手机使用独立 `mobile/Views.tsx`，不会挂载桌面首页或三维预览：异常提醒 → 快捷场景 → 常用设备 → 房间入口 → 可展开环境摘要；底部为家庭、房间、场景、我的。自动化、家庭支出、家庭成员和 VR 的完整能力保留在二级入口，权限沿用服务端和原页面。

房间按稳定 roomId 聚合，未分配设备可见。`deviceControls/model.ts` 共享能力识别、状态描述和命令分发；`deviceControls/Panel.tsx` 在手机为底部面板、桌面为侧面板，支持灯光亮度/色温、空调目标温度/模式、窗帘位置与开停关、清扫及只读传感器。滑动释放或键盘调节后才发命令，最终状态由 SSE 反馈；当前 API 不提供每台设备的完整范围/模式描述，不支持的设置由现有服务端返回原因，前端不假报成功。

收藏仅将设备 ID 保存在本浏览器，并按家庭/用户隔离，最多12项、首页前6项；不修改后端配置、不跨设备同步。存储不可用时仍可在当前页面使用。设备面板支持显式关闭和浏览器返回。

应用连接与设备在线分开显示。SSE 中断保留上次快照并标明缓存，暂停提交，提供重新连接入口；恢复网络时重新建立 SSE 获取完整状态，不增加状态轮询。首次同步显示骨架，失败、无数据和设备离线均有明确反馈。原 API、权限、数据库和 SSE 协议未修改。

## 桌面家庭总览与设备目录

桌面首页现在以异常、快捷场景、常用设备、房间状态、所选房间环境和最近活动组织内容。离线提醒可直接进入设备目录的离线筛选；场景/规则仅取最新执行结果判断失败，成功重试或删除定义后不再保留过期提醒，历史记录仍可查看。能源、门锁和布防未接入时不再放置空仪表或伪造健康状态，费用和 VR 保留独立入口。

`#devices` 为新的设备管理页：支持名称/房间/ID 搜索、按 roomId/能力展示类别/在线状态/来源筛选、仅收藏、卡片和紧凑视图，以及共享设备详情与能力控制面板。收藏与手机共用同一浏览器、同一家庭/用户的本地偏好。传感器使用只读读数，不提供假开关。接入说明仅对管理员显示；没有新增 Token 表单、设备重命名或房间配置 API。

`frontend/src/desktop/` 负责桌面专属布局；手机首页、房间和底部面板继续独立运行。设备详情补充了来源、标识、最后在线时间与能力列表。数据、命令、权限与 SSE 均沿用现有接口。

### 手机首页与语音录入

手机首页的设备在线情况、人体感应、环境读数和场景操作使用 SSE 快照。工作日／周末切换用于展示示例安排，今日安排和习惯建议均标为演示，尚未连接日程执行或习惯学习。场景按钮执行当前已保存的动作。

语音录入使用浏览器 `SpeechRecognition` 或 `webkitSpeechRecognition`，语言为 `zh-CN`。需要支持该接口的浏览器、HTTPS（本机 localhost 可用）和麦克风权限；普通局域网 HTTP 地址提供文字录入兜底。浏览器可能使用在线识别服务，界面在开始录音前告知。每次点击开始才启动识别，关闭、离开首页、切换到后台或达到 60 秒时清理录音。识别文字可编辑，仅作为本次首页内存中的演示草稿保留；离开首页或刷新会清除，不写入数据库或日志，也不触发安排或设备命令。

新建家庭及邀请加入时密码长度为 8–32 位；登录兼容历史账号的 8–128 位密码。

## Docker Compose 常驻部署

仓库根目录包含多阶段 Dockerfile、compose.yaml 和 deploy/Caddyfile。基础镜像使用可公开拉取的 `cgr.dev/chainguard/wolfi-base`，以 digest 固定内容；通过其签名包仓库安装 `nodejs-24=24.22.3-r2`，Node 版本仍为24.22.3。Wolfi 使用 glibc，新增原生依赖需在对应 Linux 架构验证，不得混入 Alpine/musl 包或宿主机 node_modules，参见 [Wolfi 官方说明](https://www.chainguard.dev/docs/open-source/wolfi)。构建时通过 apk 安装系统安全更新；Node 使用系统共享 OpenSSL 和 CA 证书库，必须保留这些运行依赖。

构建工具使用 SHA-256 校验的 npm 11.20.0 官方归档，并将其内部 brace-expansion / undici 分别固定为5.0.11 / 6.29.1修复版本。运行阶段从安装 npm 之前分支，既不安装 npm/Yarn/Corepack，也移除 apk-tools；更新依赖或系统包需重建镜像。应用以 UID/GID 1000 的非 root 用户运行，Compose 可覆盖实际服务 UID/GID；维护命令继续显式使用 `node backend/maintenance.mjs`。Caddy 提供自动 HTTPS 和 SSE 反向代理。两项服务使用 unless-stopped 自动重启，Docker 守护进程需设置开机启动。

在服务器复制 deploy/compose.env.example 为 deploy/compose.env，设置域名、数据目录及目录所有者 UID/GID。部署现有家庭时先停止旧服务，再执行下文加密迁移；迁移工具会先保存并校验加密恢复备份，再以新建的加密数据库替换旧文件。不要同时启动两个写入同一数据库的应用实例。

首次创建数据目录时使用配置的 UID/GID 设置所有者及 700 权限；示例中的域名和路径为占位值，需替换为自己的配置。部署环境文件设为 600 权限，不要提交。HA_URL、HA_TOKEN 可通过部署环境变量配置，HA_URL 必须是容器可到达的地址；跨主机连接使用 HTTPS 或受保护的专用网络。

```sh
id smarthome
docker compose --env-file deploy/compose.env config --quiet
docker compose --env-file deploy/compose.env up -d --build
docker compose --env-file deploy/compose.env ps
docker compose --env-file deploy/compose.env logs --tail 50
```

域名需解析至服务器公网 IP，云安全组需允许 TCP 80、443。Caddy 的证书与配置使用命名卷保存；家庭业务数据使用独立宿主机目录挂载。更新代码后再次执行 up -d --build。重启服务使用 docker compose --env-file deploy/compose.env restart。删除容器后重建仍使用原有数据目录；备份和恢复需在应用停止时使用下文加密维护工具。

应用仅将 3101 映射到服务器回环地址，可继续使用原 SSH 转发排查。手机直接使用 HTTPS 域名。容器通过 SMART_HOME_API_HOST 监听容器网络，默认本地开发仍绑定 127.0.0.1。Compose 显式使用 SMART_HOME_DEPLOYMENT_MODE=https，登录/退出 Cookie 始终带 Secure；不信任 X-Forwarded-* 请求头，也不启用 Express trust proxy。HTTPS 在同一部署的 Caddy 终止，应用端口只映射到宿主回环地址。此配置需要真实 HTTPS；HTTP 隧道上的登录 Cookie 不会发送。首次初始化流程见下节。



## 镜像漏洞验证

编辑器在 FROM 上展示的是上游基础镜像的漏洞统计。后续 RUN 安装安全更新不能改变该上游镜像的统计，因此需同时检查原始基础镜像、构建工具、最终运行镜像。当前 Dockerfile 的 `os-base` 阶段仅引用固定 digest 的 Wolfi 基础镜像，不执行补丁或删除操作；CI 也扫描这一阶段，避免只验证最终产物却继续引用带高危漏洞的基础镜像。npm audit 不覆盖系统包，不得关闭诊断、过滤未修复项或删除包数据库来隐藏扫描结果。

以下三个镜像均应通过 `--fail-on high`（同时检查 High 和 Critical）。基础镜像需有独立扫描结果，即使编辑器尚未显示新镜像的诊断，也不能视为自动通过：

```sh
docker build --pull --target os-base -t smart-home:os-base .
grype docker:smart-home:os-base --fail-on high
docker build --no-cache --target node-base -t smart-home:build-tools .
grype docker:smart-home:build-tools --fail-on high
docker build --target backend-test -t smart-home:backend-check .
docker build --target runtime -t smart-home:security-check .
node tools/container-smoke.mjs smart-home:security-check
grype docker:smart-home:security-check --fail-on high
```

本次验证（2026-11-22，linux/amd64，Grype 0.122.1，数据库 v6.1.10 / 2026-11-22），未配置漏洞忽略规则：

| 扫描对象 | 严重 Critical | 高危 High | 中危 Medium | 低危 Low |
| --- | ---: | ---: | ---: | ---: |
| 固定 digest 的原始 Wolfi 基础镜像 / os-base | 0 | 0 | 1 | 1 |
| Node + npm 构建工具 | 0 | 0 | 10 | 1 |
| 最终运行镜像 | 0 | 0 | 1 | 1 |

运行镜像剩余记录为 glibc-2.44 的 CVE-2026-115819（中危）与 CVE-2026-100290（低危），并非完全没有漏洞。后端60项测试在新 Linux/glibc 镜像内通过，前端生产构建成功；隔离启动验证了 Node 版本、非 root、SQLite 加密、初始化授权、Secure Cookie 及包管理器缺失，最终镜像的外部 HTTPS 请求也通过正常证书验证。编辑器仍显示旧 `node:...alpine...` 引用时，保存并重载 Dockerfile 后刷新诊断；若新引用仍有告警，应检查其实际 CVE 与扫描库时间，不能直接视为误报或关闭诊断。

Grype 的 high 阈值同时拦截 High 和 Critical，不忽略尚无修复的漏洞。扫描结果随数据库、架构和上游补丁变化；一次扫描通过不代表永久无漏洞。GitHub CI 会同时验证 Linux 后端测试、原始基础镜像、构建工具和运行镜像；Gitee 部署仍需自行执行这些检查。服务器更新需先按加密迁移要求处理现有数据库，再运行 `docker compose --env-file deploy/compose.env build --pull --no-cache app` 并重建容器，单独 restart 不会更新镜像。运行容器没有 npm，依赖更新必须重建镜像；维护命令继续使用 node。

## 加密迁移、备份与恢复操作

以下路径是示例。以实际服务 UID/GID 创建 secrets 目录（0700）并拥有其中的密钥（0600）；不要改变已有家庭数据路径以绕过迁移。使用项目固定的 Node 版本，在仓库根目录生成一次密钥，命令不会输出密钥，也拒绝覆盖已有密钥：

```sh
node backend/maintenance.mjs keygen --key-file /srv/smart-home/secrets/data.key
```

将 `SMART_HOME_DATA_KEY_HOST_FILE=/srv/smart-home/secrets/data.key` 写入 `deploy/compose.env`；该路径必须位于 `SMART_HOME_HOST_DATA_DIR` 之外，密钥所属 UID 与 app 用户一致。Compose secret 的本机文件权限以宿主为准，不能依靠 Compose 自动修改为0600。构建新代码后停止旧 app，首次对 schema v1 执行一次迁移（纯新家庭跳过 migrate）：

```sh
docker compose --env-file deploy/compose.env build app
docker compose --env-file deploy/compose.env stop app
docker compose --env-file deploy/compose.env run --rm --no-deps app node backend/maintenance.mjs migrate --data-dir /data --key-file /run/secrets/data_key --file /data/before-encryption.homeos.enc
docker compose --env-file deploy/compose.env up -d
```

若旧版本为直接运行 Node，先停止该进程再执行维护，不能同时运行旧版本和新容器。迁移遇到 `home.sqlite-wal` / `-shm` / `-journal` 会拒绝，应先确认旧进程完全停止并用 SQLite 正常 checkpoint/关闭，不能直接删除这些文件。加密备份含完整快照和旧数据库/原 JSON 的加密副本，校验新库后清理旧 JSON 与旧 `.bak`，原数据库以原子 rename 替换；失败前不会用一个不完整的新库覆盖原库。磁盘历史副本需另外处理。

日常停服备份（每次使用不同文件名，示例文件不允许重复覆盖）：

```sh
docker compose --env-file deploy/compose.env stop app
docker compose --env-file deploy/compose.env run --rm --no-deps app node backend/maintenance.mjs backup --data-dir /data --key-file /run/secrets/data_key --file /data/household-2026-11-22.homeos.enc
docker compose --env-file deploy/compose.env up -d app
```

可将 `.homeos.enc` 单独传到备份存储；恢复时使用独立保管的同一密钥。通过具备 Node 24 的维护主机运行下列命令；恢复目录必须不存在，恢复成功后将其设置为实际服务的数据目录并校正 UID/GID：

```sh
node backend/maintenance.mjs restore --key-file /srv/smart-home/secrets/data.key --data-dir /srv/smart-home/restored-data --file /srv/backups/household-2026-11-22.homeos.enc
```

初次迁移后的旧程序无法读取 schema v2。应用回退只能选择支持 schema v2 的版本，维护工具不提供明文降级。工具不输出家庭数据/密钥；错误只输出通用失败信息，已有恢复目标不被覆盖。

## 首次初始化、安全 Cookie 与隔离演示

`SMART_HOME_DEPLOYMENT_MODE` 只接受 `local` / `https`。未设置时，NODE_ENV=production 默认 https，其余默认 local。https 模式禁止 --skip-login，默认拒绝首次管理员创建（403），不会影响已有 SQLite 家庭登录。local 模式仅允许直接连接来自回环地址、且 Host 为 localhost / 127.0.0.1 / [::1] 的首次创建；Vite 同源代理保留 Host，默认开发与直接 Node 的 SSH 隧道初始化不变。不要在公开部署中使用 local 或免登录模式。

`--skip-login` 同样校验回环对端和本地 Host，不接受伪造的 X-Forwarded-*；NODE_ENV=production 即使显式指定 local 也拒绝免登录，并在打开数据库之前退出。应用所有响应禁止 iframe 嵌入和 MIME 嗅探，关闭 Referrer 及 Express 版本标识。登录限流通过 `SMART_HOME_TRUSTED_PROXY_IP` 只接受一个明确的直连代理 IP；Caddy 用 `{remote_host}` 覆盖 `X-Smart-Home-Client-IP`，不接受浏览器伪造的原值。其余连接忽略全部转发头、按直连对端限流。缺失/非法代理身份头返回400。不同客户端地址拥有独立的10次/15分钟配额，成功登录只清理自己的计数；共享公网 NAT 地址的客户端仍共享额度。内存计数有上限且会过期，重启后重置，不代替入口对分布式流量的防护。Compose 使用固定的 Caddy 容器地址（默认172.30.47.3）匹配此信任；若网段冲突，需一起修改子网、app 和 Caddy 三个地址。不启用 Express trust proxy，不影响 Host、Secure Cookie 或初始化授权。参见 [Caddy header_up](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers)。

SQLite 敏感内容和完整恢复备份均已加密，密钥通过只读 Compose secret 文件挂载，不放入镜像、业务数据、环境变量或日志。宿主及 Docker 管理员仍属于信任边界，拥有读取运行中密钥的能力；HA/初始化环境凭据也对其可见。升级不会自动迁移服务器或更新运行中的容器。

推荐先通过 SSH 隧道，在仅绑定 127.0.0.1 的 Node 进程中使用 local 模式初始化家庭，再停止该进程，挂载同一数据目录启动 https 部署，最后开放 Caddy 公网入口。既有数据库无需重新初始化。容器的 NAT 对端不一定是回环地址，因此容器内不要靠 local 模式绕过初始化限制。

若直接使用容器初始化：先仅启动 app（不要启动 Caddy/公网入口），临时配置 SMART_HOME_BOOTSTRAP_TOKEN 为密码管理器生成的至少32字符随机值；通过 SSH 隧道对 /api/auth/setup 发送 JSON（homeName、username、displayName、password），额外带 X-Bootstrap-Token 请求头。仅首次创建接受此授权；家庭存在后始终返回409，Token不能访问业务 API。不要把 Token 放在 URL、日志或仓库中，也不要把真实密码写进 shell 历史。完成后移除 Token，重建 app，再启动 Caddy，通过正式 HTTPS 重新登录。HTTP 隧道初始化返回的 Secure Cookie 不用于登录。管理员可在已有页面发出限时访客邀请，访客仍只能控制设备/场景，不能管理家庭、自动化或账单。

演示请使用一个全新的临时 SMART_HOME_DATA_DIR，清除 HA_URL、HA_TOKEN、HA_ROOMS_FILE、HA_ENTITY_PREFIX 等集成环境变量，只使用内置 MockProvider；不要复制现有 backend/data 或家庭数据库。运行数据 state.json 已从 Git 索引移除但保留本机文件；历史提交不因此消失，如曾提交真实信息需另行评估历史清理。新环境已有不含账单账号的内置种子，无需运行时 JSON 文件。测试只使用临时目录，不接触实际家庭数据。
