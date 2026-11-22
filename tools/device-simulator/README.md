# Virtual Home Device Simulator

这是扮演外部硬件的独立 Node.js/TypeScript 开发工具，不是前端 Mock。生产运行代码只通过 MQTT 与 Home Assistant 通信，不导入业务 Backend、Provider、数据库或 React。`test/e2e.ts` 是单独的验收驱动，才会启动临时业务后端。

## 安装与启动

仓库使用 Node 24.22.3、npm 11.19.1。源码目录采用紧凑结构，未按每台设备拆文件：

- `src/core.ts`：VirtualDevice、确定性时钟、状态校验、延迟命令、动态设备、场景和 Reset。
- `src/mqtt.ts`：Discovery、主题解析、状态编码、MQTT 重连和 Availability。
- `src/control.ts`：仅绑定 localhost 的 Control API，无业务后端连接。
- `src/index.ts`：运行入口，每 200ms 推进确定性时钟。
- `test/`：独立核心、协议、API 测试及真实 HA 验收脚本。
- `compose.yml`、`mosquitto.conf`：复用现有隔离 HA/Mosquitto 开发栈，不另建第二套 infra。
- `lab-auth.mjs`：仅供测试的已有实验环境认证工具。

```sh
npm ci --prefix backend
npm ci --prefix tools/device-simulator
docker compose -f tools/device-simulator/compose.yml up -d
npm run dev --prefix tools/device-simulator
```

HA: http://127.0.0.1:18123，MQTT: `127.0.0.1:18883`，Control API: `127.0.0.1:8090`。
复制本目录 `.env.example` 为 `.env` 可覆盖连接、Discovery prefix、Control 端口及 MQTT 用户名密码；npm start/dev 自动加载本目录 `.env`。默认始终 deterministic，不使用随机数；`SIMULATOR_DETERMINISTIC=false` 当前也不会引入随机行为。

首次在 HA 完成家庭初始化，然后：Settings → Devices & services → Add Integration → MQTT。Compose 内 Broker 地址是 `mqtt`，端口 `1883`，协议 `3.1.1`，本机隔离实验无需用户名密码。不要将匿名 Broker 暴露公网。

实验脚本可对全新的默认本机 HA 执行 `npm run test:e2e --prefix tools/device-simulator -- --bootstrap` 自动配置。已有家庭不会被覆盖。已有实验刷新凭据 `.lab-auth.json` 为 0600，已被 Git 与源码归档排除；不要分享。人工配置的 HA 则通过后端 `HA_TOKEN` 提供凭据，不能使用 VITE_ 环境变量或浏览器存储。

## 固定设备

| ID | 设备与默认状态 |
|---|---|
| sim_living_room_light | 客厅灯：关闭，亮度70%，3500K |
| sim_bedroom_light | 主卧灯：关闭，亮度70%，3500K |
| sim_living_room_curtain | 窗帘：位置20%，每秒20个百分点，可开/关/停止/设置位置 |
| sim_living_room_environment | 一台物理环境设备，4实体：24°C、45%、PM2.5 12、CO₂ 650 |
| sim_living_room_motion | 人体 occupancy=false |
| sim_bedroom_ac | off，当前27°C、目标23°C，cool/heat/auto以0.15°C/s逐渐响应 |
| sim_entrance_contact | 门磁 closed，不含锁或解锁命令 |
| sim_robot_vacuum | docked、电量92%，清扫缓慢耗电，返回3秒后停靠并充电 |

灯光命令延迟200ms，其他控制延迟100ms。传感器由事件触发。Reset 取消未执行命令、场景和运动，恢复默认状态。

## Topic 与 Discovery

固定根主题：`smart-home-simulator/devices/{deviceId}`。

- `/set`：灯光 JSON、窗帘 OPEN/CLOSE/STOP、vacuum start/pause/stop/return_to_base。
- `/position/set`：窗帘目标0–100；`/mode/set`、`/temperature/set`：空调模式和目标温度。
- `/state`：设备报告；`/attributes`：`source=simulator`、`last_seen` 及扫地机电量。
- `/availability`：**逐台设备** online/offline。

Discovery 为 `homeassistant/{domain}/{id}/config`。环境多实体使用推荐的 `homeassistant/device/{id}/config` Device Discovery，共享同一物理设备 identifiers；不会拆成四台无关硬件。稳定 ID 同时作为 unique_id 和 entity object ID；当前 HA 使用 `default_entity_id` 设置实体 ID，替代旧的 object_id 配置键。

Discovery、状态和 Availability 均 retained。监听 `{MQTT_DISCOVERY_PREFIX}/status` 的 online 后重新发布 Discovery 与当前状态。共享进程遗嘱 `smart-home-simulator/availability=offline` 与逐台 availability 通过 HA `availability_mode=all` 结合，异常断线使全部设备离线，单台离线只影响该设备。已离线设备忽略 MQTT 命令，不发布伪造成功。

## Control API

只接受本机连接及 JSON；拒绝跨源修改请求，body 上限16KB。API不调用业务后端，变更产生 core change 事件，由 MQTT Adapter 发布。

```sh
curl http://127.0.0.1:8090/health
curl http://127.0.0.1:8090/devices
curl http://127.0.0.1:8090/devices/sim_living_room_light
curl -X POST http://127.0.0.1:8090/devices/sim_living_room_motion/state -H 'Content-Type: application/json' -d '{"occupancy":true}'
curl -X POST http://127.0.0.1:8090/devices/sim_living_room_environment/state -H 'Content-Type: application/json' -d '{"temperature":28}'
curl -X POST http://127.0.0.1:8090/devices/sim_living_room_light/state -H 'Content-Type: application/json' -d '{"online":false}'
curl -X POST http://127.0.0.1:8090/devices/sim_living_room_light/state -H 'Content-Type: application/json' -d '{"online":true}'
curl -X POST http://127.0.0.1:8090/reset -H 'Content-Type: application/json' -d '{}'
```

控制灯光可以在 HA 或 Home OS 发命令；Control API 的 `/state` 是模拟物理状态变化，不是应用控制接口。

## 场景

`POST /scenarios/{name}/run`，JSON body 默认 `{}`：

- `normal-day`：60秒确定性温湿度缓慢波动。
- `night-motion`：占用5秒后清除，返回 simulatedTime=23:30 元数据；不改变主机或 HA 时钟，不执行自动开灯。测试时间条件需要外部自动化时钟机制。
- `bad-air-quality`：每秒650→750→850→1000→1200→1400 ppm。
- `device-offline`：默认客厅灯离线5秒，可传 `{"deviceId":"sim_robot_vacuum","durationMs":10000}`。
- `energy-spike`：明确返回 reserved，业务尚无 powerMeter，不伪造能源数值。

```sh
curl -X POST http://127.0.0.1:8090/scenarios/bad-air-quality/run -H 'Content-Type: application/json' -d '{}'
```

## 测试与手工验证

```sh
npm run typecheck --prefix tools/device-simulator
npm test --prefix tools/device-simulator
npm test --prefix backend
npm run test:e2e --prefix tools/device-simulator
# 可选：额外重启独立实验 HA 容器检查恢复
npm run test:e2e --prefix tools/device-simulator -- --restart-ha
```

单元测试不需要 HA；包含内嵌临时 MQTT Broker。E2E 只消费 SSE 快照（不轮询 /state），覆盖断开期间遥测的重连补同步；需要上述 Compose 栈及实验 Token，使用临时本机后端，结束清理临时状态。不要同时启动两个相同 Virtual Home 模拟器：固定 MQTT client ID 会相互踢下线。

最简手工链路：启动 Compose → 配置 MQTT → 启动模拟器 → HA 出现8台物理设备/11个实体 → HA 打开客厅灯 → 日志显示 command queued → 200ms 后发布 state → HA显示开启 → Home OS 的 HomeAssistantProvider 收到 WS 更新 → 前端 SSE 实时更新。

后端设置 `HA_URL=http://127.0.0.1:18123`、服务端 `HA_TOKEN`、`HA_ENTITY_PREFIX=sim_`。可用 `HA_ROOMS_FILE` 配置 `{"light.sim_living_room_light":{"id":"living","name":"客厅"}}`；未分配时在“全部设备”查看。不新增 SimulatorProvider。

故障排查：先查 `/health` 的 mqttConnected；检查 HA Broker 是容器内 `mqtt:1883`，宿主机模拟器是18883；检查 Discovery prefix；确认同一client ID没有重复进程；检查 HA MQTT 日志里的配置错误。旧版 `homeos_sim_*` retained 实体可能留在复用实验 Broker/HA 中，本版只操作 `sim_*`，不会擅自删除旧实体。重新发布 HA Birth 可恢复 Discovery。

停止：Ctrl-C 停模拟器；`docker compose -f tools/device-simulator/compose.yml down` 停实验容器，保留配置卷。

## 与现有架构的差异、限制与下一步

复用 Device/Capability/DeviceState/DeviceCommand/DeviceProvider/MockProvider/HomeAssistantProvider。为兼容现有窗帘 UI，原 `position=open/stop/closed` 保留，另加 `positionPercent` 表示数值位置；加入 colorTemperature、pm25、co2、occupancy、contact 能力及 simulator 来源、lastSeenAt。HA unavailable 丢弃自定义属性时由 Provider 内存缓存保留最后在线时间和来源。

保留首页布局；首页已读取温湿度、PM2.5、CO₂ 和人体感应并标注模拟来源；未接入或离线的数据呈现暂无数据。前端使用同源鉴权 SSE，重连时获取当前完整快照。最后在线时间和规范化 Provider 缓存已保存到 SQLite，重启后先显示离线直到 Provider 确认。夜间场景只生成事件，不实现 Automation。

下一步应接入已有业务事件持久化、可测试的自动化时钟，之后再实现 command timeout/failure 注入；本版不伪装已具备这些能力。

## 本次实施验证记录

- TypeScript 类型检查通过。模拟器7项独立测试、后端25项测试通过；前端类型检查及构建通过。
- 真实 HA 2026.11.1 / Mosquitto 2.0.22 上 A–D 均通过：灯光闭环、Control API 人体事件、逐设备离线恢复并保留 lastSeenAt、6个连续 CO₂ 样本。
- 窗帘渐进位置、空调慢降温、扫地机器人命令、HA Birth 重发现、Reset 已在真实链路验证。
- 验证通过业务 API 快照检查，未新增前端传感器展示；不把 API 验收等同于新 UI 展示验收。
- 实际重启 HA 容器后自动恢复并再次控制灯光通过。

SSE 验收：真实 MQTT→HA→Provider→SSE 测试通过；断流期间更新遥测后重连可恢复完整当前态。浏览器测试实际关闭/重启隔离后端后自动重连并显示1450ppm，网络记录无 `/api/state` 轮询。正常鉴权后端重启仍会使内存会话失效，需要重新登录，未绕过原鉴权行为。

场景验收已纳入 E2E：创建/编辑自定义场景，经 HA/MQTT 将灯光设置为35%、窗帘设置为50%，通过 SSE 核对设备反馈；离线场景失败显示原因并跳过余下动作，最后删除测试场景。

自动化验收已纳入 `test:e2e`：测试后端独立注入 Asia/Shanghai 的23:30判定时间，真实人体 MQTT 变化调用已有15%亮度场景，验证SSE设备反馈与执行日志；同时覆盖白天预览不匹配、预览不执行、禁用不触发及离线失败。测试时钟不修改主机/HA/设备时间，仅在 NODE_ENV=test 且本机免登录模式生效。正式引擎按实际时间执行。

SQLite 验收（Node 26.13.1 / npm 11.20.0）：从旧 JSON 启动，确认仅导入一次；保存设备、场景、规则及成功/失败日志后重启业务后端，通过 SSE 确认恢复，再触发人体事件验证规则仍经 HA/MQTT 控制灯光。旧 JSON 经事务导入后以加密备份保存并移除明文；schema v2 的业务字段和场景命令加密，测试临时密钥与临时目录一同清理。
