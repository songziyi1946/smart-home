import { useState } from "react";
import { Button } from "@arco-design/web-react";
import {
  LogOut,
  House,
  Users,
  Plug,
  ChevronRight,
  SlidersHorizontal,
  Zap,
  ReceiptText,
  Box,
  ShieldCheck,
} from "lucide-react";
import type { Session, State } from "../types";
import Members from "./Members";
import { formatTime } from "../utils";
import { useMobile } from "../mobile/hooks";
import {
  roleNames,
  roleDetails,
  permissionRows,
  integrationSummary,
} from "./model";
import "./style.css";
export default function Profile({
  state,
  session,
  busy,
  pending = false,
  onLogout,
  onSessionExpired,
  onDevices,
  initialSection = "general",
}: {
  state: State;
  session: Session;
  busy: boolean;
  pending?: boolean;
  onLogout: () => void;
  onSessionExpired: () => void;
  onDevices: () => void;
  initialSection?: "general" | "members";
}) {
  const mobile = useMobile(),
    [section, setSection] = useState(initialSection as string);
  const { user } = session,
    preview = !!session.localPreview,
    admin = user.role === "admin",
    providers = integrationSummary(state.devices);
  const permissions = (
    <details className="panel settings-permissions">
      <summary>查看三种身份的权限范围</summary>
      <div className="settings-permission-grid">
        {(["admin", "member", "guest"] as const).map((role) => (
          <article key={role}>
            <h3>{roleNames[role]}</h3>
            <ul>
              {permissionRows.map((row) => (
                <li key={row.name}>
                  <span>{row.name}</span>
                  <strong>{row[role]}</strong>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <p className="settings-muted">
        权限由服务端校验。访客的场景执行记录仅包含本人操作。
      </p>
    </details>
  );
  const integrations = (
    <div className="settings-integrations">
      <section className="panel">
        <header>
          <div>
            <h2>设备接入</h2>
            <p className="settings-muted">
              以下是现有能力与设备快照，不是服务商连接诊断。
            </p>
          </div>
          <a href="#devices">
            查看设备 <ChevronRight size={16} />
          </a>
        </header>
        <div className="settings-provider-list">
          <article>
            <div>
              <h3>MockProvider</h3>
              <span className="settings-badge">已实现 · 模拟设备</span>
            </div>
            <p>{providers.mock} 项模拟设备记录，用于开发和演示。</p>
          </article>
          <article>
            <div>
              <h3>Home Assistant</h3>
              <span className="settings-badge">已实现 · 服务端配置</span>
            </div>
            <p>
              {providers.ha
                ? `发现 ${providers.ha} 项设备记录，其中 ${providers.haOnline} 项设备在线。`
                : "当前没有 HA 设备记录，无法据此确认是否已配置连接。"}
            </p>
            <small>
              支持设备发现、能力控制和状态订阅；具体可用能力取决于接入实体。
            </small>
          </article>
          <article>
            <div>
              <h3>MQTT 虚拟设备模拟器</h3>
              <span className="settings-badge">已实现 · 本地运行</span>
            </div>
            <p>
              {providers.simulator
                ? `当前 ${providers.simulator} 项设备状态标记为模拟器来源。`
                : "当前没有模拟器来源的设备记录。"}
            </p>
            <small>
              通过 Home Assistant Discovery 接入，可用于无硬件测试。
            </small>
          </article>
          <article>
            <div>
              <h3>Matter / 厂商直连</h3>
              <span className="settings-badge muted">尚未接入</span>
            </div>
            <p>没有网页配网、厂商账号绑定或自动发现配网入口。</p>
          </article>
        </div>
      </section>
      {admin && (
        <section className="panel settings-setup">
          <h2>现有接入步骤</h2>
          <ol>
            <li>
              <strong>准备 Home Assistant</strong>
              <p>先在 HA 中接入设备，确认实体可读取和控制。</p>
            </li>
            <li>
              <strong>由部署者配置后端</strong>
              <p>
                设置 <code>HA_URL</code>、<code>HA_TOKEN</code>；可选{" "}
                <code>HA_ENTITY_PREFIX</code> 筛选实体，
                <code>HA_ROOMS_FILE</code> 映射房间。
              </p>
            </li>
            <li>
              <strong>重启后端并检查设备</strong>
              <p>
                在设备页检查在线状态、能力与来源。此页面不接收或保存 Token。
              </p>
            </li>
          </ol>
          <p className="settings-muted">
            完整命令见项目 README 的“开发与设备接入”，以及
            tools/device-simulator/README.md。连接错误需由部署者查看服务端配置和日志。
          </p>
        </section>
      )}
    </div>
  );
  return (
    <div className={"settings-page" + (mobile ? " settings-mobile" : "")}>
      {(!mobile || section === "general") && (
        <section className="panel settings-hero">
          <span className="settings-home-icon">
            <House size={26} />
          </span>
          <div>
            <small>{preview ? "本地开发预览" : "当前家庭"}</small>
            <h2>{session.household.name}</h2>
            <p>
              {user.displayName} · {roleNames[user.role]}
            </p>
          </div>
          <div className="settings-hero-action">
            {admin && !preview ? (
              <Button
                icon={<Users size={16} />}
                disabled={busy}
                onClick={() => setSection("members")}
              >
                成员与邀请
              </Button>
            ) : (
              <span className="settings-badge">
                {preview ? "未启用真实登录" : "按当前身份访问"}
              </span>
            )}
          </div>
        </section>
      )}
      <nav className="settings-tabs" aria-label="家庭设置视图">
        {[
          { id: "general", name: "家庭与账户", Icon: House },
          { id: "members", name: "成员与权限", Icon: Users },
          { id: "integrations", name: "设备接入", Icon: Plug },
        ].map(({ id, name, Icon }) => (
          <button
            key={id}
            aria-pressed={section === id}
            onClick={() => setSection(id)}
          >
            <Icon size={16} />
            {name}
          </button>
        ))}
      </nav>
      {section === "general" && (
        <>
          <div className="settings-general-grid">
            <section className="panel">
              <header>
                <h2>我的家庭</h2>
                <span className="settings-badge">信息查看</span>
              </header>
              <dl className="settings-facts">
                <div>
                  <dt>家庭名称</dt>
                  <dd>{session.household.name}</dd>
                </div>
                <div>
                  <dt>设备记录</dt>
                  <dd>
                    {state.devices.length} 项 <a href="#devices">查看设备</a>
                  </dd>
                </div>
                <div>
                  <dt>成员管理</dt>
                  <dd>
                    {preview
                      ? "真实登录后可用"
                      : admin
                        ? "管理员可邀请、移除成员"
                        : "仅管理员可查看与管理"}
                  </dd>
                </div>
              </dl>
              <p className="settings-muted">
                家庭改名、房间维护、多家庭切换尚未提供配置入口。
              </p>
            </section>
            <section className="panel">
              <header>
                <h2>我的账户</h2>
                <ShieldCheck size={19} />
              </header>
              <div className="settings-account">
                <span className="settings-avatar">
                  {user.displayName.slice(0, 1)}
                </span>
                <div>
                  <strong>{user.displayName}</strong>
                  <small>
                    @{user.username} · {roleNames[user.role]}
                  </small>
                </div>
              </div>
              <p className="settings-muted">{roleDetails[user.role]}</p>
              {!session.localPreview ? (
                <>
                  <details className="settings-session">
                    <summary>登录与访问有效期</summary>
                    <dl className="settings-facts">
                      <div>
                        <dt>账户创建</dt>
                        <dd>{formatTime(session.user.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>本次登录</dt>
                        <dd>{formatTime(session.loggedInAt)}</dd>
                      </div>
                      <div>
                        <dt>会话有效至</dt>
                        <dd>
                          {formatTime(
                            new Date(session.expiresAt).toISOString(),
                          )}
                        </dd>
                      </div>
                      {session.user.accessExpiresAt && (
                        <div>
                          <dt>家庭访问至</dt>
                          <dd>
                            {formatTime(
                              new Date(
                                session.user.accessExpiresAt,
                              ).toISOString(),
                            )}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </details>
                  <Button
                    disabled={pending}
                    icon={<LogOut size={16} />}
                    onClick={onLogout}
                  >
                    退出登录
                  </Button>
                </>
              ) : (
                <p className="settings-muted">
                  本地预览不创建真实账户或成员；请以正常登录模式运行后使用成员管理。
                </p>
              )}
              <p className="settings-muted">
                头像、显示名和密码修改尚未提供设置入口。
              </p>
            </section>
          </div>
          {mobile && (
            <section className="panel settings-shortcuts">
              <h2>常用入口</h2>
              {[
                { id: "devices", name: "全部设备", Icon: SlidersHorizontal },
                ...(user.role !== "guest"
                  ? [
                      { id: "automation", name: "自动化", Icon: Zap },
                      { id: "billing", name: "能源与缴费", Icon: ReceiptText },
                    ]
                  : []),
                { id: "vr", name: "空间视图", Icon: Box },
              ].map(({ id, name, Icon }) => (
                <a
                  key={id}
                  href={id === "devices" ? "#rooms" : "#" + id}
                  onClick={(e) => {
                    if (id === "devices") {
                      e.preventDefault();
                      onDevices();
                    }
                  }}
                >
                  <Icon size={18} />
                  <span>{name}</span>
                  <ChevronRight size={16} />
                </a>
              ))}
            </section>
          )}
        </>
      )}
      {section === "members" && (
        <>
          {preview ? (
            <section className="panel settings-unavailable">
              <h2>成员管理需要真实登录</h2>
              <p>
                本地预览不生成邀请，也不展示虚构成员。请由部署者以正常登录模式启动服务。
              </p>
            </section>
          ) : admin ? (
            <Members
              currentUserId={user.id}
              disabled={busy}
              onSessionExpired={onSessionExpired}
            />
          ) : (
            <section className="panel settings-unavailable">
              <h2>你的身份：{roleNames[user.role]}</h2>
              <p>{roleDetails[user.role]}</p>
              <p>
                成员名单和邀请仅管理员可查看。需要新增成员或调整访问权限时，请联系家庭管理员。
              </p>
              {!session.localPreview && session.user.accessExpiresAt && (
                <p>
                  访问有效至{" "}
                  {formatTime(
                    new Date(session.user.accessExpiresAt).toISOString(),
                  )}
                </p>
              )}
            </section>
          )}
          {permissions}
        </>
      )}
      {section === "integrations" && integrations}
    </div>
  );
}
