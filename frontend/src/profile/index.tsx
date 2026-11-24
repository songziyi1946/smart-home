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
  Sparkles,
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
import type { Installation } from '../pwa';
import InstallApp from './InstallApp';
import HouseholdName from './HouseholdName';
import MijiaConnection from './MijiaConnection';
import AIConnections from './AIConnections';
export default function Profile({
  state,
  session,
  householdName,
  busy,
  pending = false,
  onLogout,
  onSessionExpired,
  onDevices,
  initialSection = "general",
  installation,
  onSessionUpdated,
}: {
  state: State;
  session: Session;
  householdName: string;
  busy: boolean;
  pending?: boolean;
  onLogout: () => void;
  onSessionExpired: () => void;
  onDevices: () => void;
  initialSection?: "general" | "members";
  installation: Installation;
  onSessionUpdated: (session: Session) => void;
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
    </details>
  );
  const integrations = (
    <div className="settings-integrations">
      <MijiaConnection session={session} disabled={busy} onSessionExpired={onSessionExpired} />
      <section className="panel">
        <header>
          <h2>设备来源</h2>
          <a href="#devices">
            查看设备 <ChevronRight size={16} />
          </a>
        </header>
        <div className="settings-provider-list">
          <article><div><h3>米家</h3></div><p>{providers.mijia ? `${providers.mijiaOnline} / ${providers.mijia} 项设备在线` : '暂无设备记录'}</p></article>
          <article>
            <div>
              <h3>模拟设备</h3>
            </div>
            <p>{providers.mock} 项设备记录</p>
          </article>
          <article>
            <div>
              <h3>Home Assistant</h3>
            </div>
            <p>
              {providers.ha
                ? `${providers.haOnline} / ${providers.ha} 项设备在线`
                : "暂无设备记录"}
            </p>
          </article>
          <article>
            <div>
              <h3>MQTT 虚拟设备模拟器</h3>
            </div>
            <p>
              {providers.simulator
                ? `${providers.simulator} 项模拟设备记录`
                : "暂无设备记录"}
            </p>
          </article>
          <article>
            <div>
              <h3>Matter / 厂商直连</h3>
              <span className="settings-badge muted">尚未接入</span>
            </div>
          </article>
        </div>
      </section>

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
            <h2>{householdName}</h2>
            <p>
              {user.displayName} · {roleNames[user.role]}
            </p>
          </div>
          {admin && !preview && (
            <div className="settings-hero-action">
              <Button
                icon={<Users size={16} />}
                disabled={busy}
                onClick={() => setSection("members")}
              >
                成员与邀请
              </Button>
            </div>
          )}
        </section>
      )}
      <nav className="settings-tabs" aria-label="家庭设置视图">
        {[
          { id: "general", name: "家庭与账户", Icon: House },
          { id: "members", name: "成员与权限", Icon: Users },
          { id: "integrations", name: "设备接入", Icon: Plug },
          ...(user.role !== "guest" ? [{ id: "ai", name: "我的 AI", Icon: Sparkles }] : []),
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
              </header>
              <dl className="settings-facts">
                <div>
                  <dt>家庭名称</dt>
                  <dd><HouseholdName session={session} name={householdName} disabled={busy} onSaved={onSessionUpdated} onSessionExpired={onSessionExpired} /></dd>
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
                  账户功能需登录后使用。
                </p>
              )}
            </section>
          </div>
          <InstallApp installation={installation} />
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
              <h2>请先登录</h2>
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
      {section === "ai" && user.role !== "guest" && <AIConnections session={session} disabled={busy} onSessionExpired={onSessionExpired} />}
    </div>
  );
}
