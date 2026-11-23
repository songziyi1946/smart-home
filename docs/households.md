# 每户独立的家庭工作台

当前采用**每个家庭一套服务实例**：数据库、密钥、设备接入配置、管理员、成员与访客均独立。朋友管理自己的家庭时，给朋友创建新的实例，不要给他发送你家的成员邀请码。这不是同一个服务器里的家庭切换或公开注册系统。

## 创建与本机初始化

先按主 README 安装依赖并构建前端。以下命令从仓库根目录运行，使用 `.nvmrc` 指定的 Node.js，以专门运行家庭服务的非 root 用户初始化。目标父目录须已存在且该用户可写，目标目录必须是全新的绝对路径：

```sh
node tools/create-household.mjs init --directory /srv/home-alice --id home-alice --port 3101 --slot 47
node tools/create-household.mjs start --directory /srv/home-alice
```

浏览器打开 `http://127.0.0.1:3101`，创建该家庭的名称与管理员。名称以后可以在家庭设置中修改。服务默认只监听本机，仍须登录；初始化沿用本机来源限制，远程机器可通过 SSH 本地转发访问。退出服务使用 Ctrl+C。

初始化命令只创建新目录和配置，不读取已有家庭数据、不覆盖文件、不自动创建账户。目录为 700，密钥和配置为 600（Windows 使用其文件权限机制）。生成内容：

```text
/srv/home-alice/
  data/             # 此家庭自己的加密 SQLite 与运行数据
  data.connections/ # 此家庭独立的加密云授权，首次选择家庭后写入
  secrets/data.key  # 只属于此家庭，位于 data 目录之外
  .env.local        # 本机启动配置，设备接入默认留空
  .env.compose      # 公网部署配置，域名默认是待修改的 example.com
```

可编辑 `.env.local` 中的 HA 配置接入该家庭自己的 Home Assistant。`start` 使用此家庭配置覆盖启动终端中的同名变量，避免意外继承另一个家庭的设备连接。接入凭据只保存在服务端私有配置中。

给第二个家庭使用另一个目录、标识和本机端口；若在同一 Docker 主机运行，网络编号也必须不同：

```sh
node tools/create-household.mjs init --directory /srv/home-bob --id home-bob --port 3102 --slot 48
node tools/create-household.mjs start --directory /srv/home-bob
```

同一主机名的 Cookie 不区分端口。本机同时测试两个家庭时，使用不同浏览器资料分别登录；公网每户必须使用不同的主机名。

## 公网部署

每户推荐在自己家中可访问设备网关的主机上运行。先完成上面的私下初始化，再配置公网；保持现有 HTTPS、安全 Cookie、可信代理和禁止公开初始化的政策。

编辑该户 `.env.compose`：

- 将 `SMART_HOME_DOMAIN` 改为已解析到本机的真实域名。
- 保持独立的 `SMART_HOME_INSTANCE_NAME`、数据目录和密钥路径。
- 填写该户自己的 `HA_URL`、`HA_TOKEN` 等服务端接入信息（如果使用）。
- 确认 UID/GID 可以读取该户的私有目录与密钥。生成配置默认采用运行初始化命令的用户 UID/GID。
- 保持 `SMART_HOME_BOOTSTRAP_TOKEN` 为空；已私下初始化的家庭无需开放首次注册。

```sh
node tools/create-household.mjs compose --directory /srv/home-alice -- up -d --build
```

每个实例使用自己的 Compose 项目名称、数据目录、密钥、网络和 Caddy 数据卷。此入口将该户配置覆盖启动终端中的同名变量，显式固定项目名称，拒绝用命令参数覆盖家庭配置，并校验容器运行 UID/GID 均非 root。日常更新继续使用对应家庭的 `--directory`；停止实例可将命令末尾替换为 `-- down`（不加 `--volumes`，保留数据卷）。

多个实例共用一台服务器时，各实例不能争用同一宿主端口：为各户设置不同的 `SMART_HOME_LOCAL_PORT`、`SMART_HOME_HTTP_PORT`、`SMART_HOME_HTTPS_PORT` 和网络编号。标准公网 443 的多域名入口需要部署者另行配置统一入口，将每户域名转发到对应实例；当前 Compose 不会自动配置这一层，也不会自动信任额外代理。每户单独一台主机时，HTTP/HTTPS 默认 80/443 即可。

网关仅可在家庭局域网访问时，公网服务器仍需受保护的家中连接通道；填写内网 IP 本身不会让云服务器自动连进家中。

## 备份和恢复

每户单独保存密钥与加密备份。使用 `backend/maintenance.mjs backup/restore` 时传入对应家庭的 `data` 和 `secrets/data.key`；操作前停止该实例。恢复只接受新目标目录，不能把其他家庭的数据库或密钥覆盖进去。具体命令见[开发与部署指南](technical-guide.md#加密迁移备份与恢复操作)。
