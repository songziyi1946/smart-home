import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@arco-design/web-react";
import { UserPlus, RefreshCw, ShieldCheck, ArrowLeft, CircleHelp } from "lucide-react";
import { ApiError, request } from "../api";
import type { User } from "../types";
import { formatTime } from "../utils";
import { useMobile } from "../mobile/hooks";
import { roleNames, roleDetails, guestAccessText } from "./model";
export { roleNames } from "./model";
type Invite = {
  code: string;
  expiresAt: number;
  role: "member" | "guest";
  guestHours: number;
};
export default function Members({
  onSessionExpired,
  currentUserId,
  disabled,
  onShowPermissions,
}: {
  onSessionExpired: () => void;
  currentUserId: string;
  disabled: boolean;
  onShowPermissions: () => void;
}) {
  const mobile = useMobile(),
    [members, setMembers] = useState<User[]>([]),
    [loaded, setLoaded] = useState(false),
    [loading, setLoading] = useState(true),
    [role, setRole] = useState<"member" | "guest">("member"),
    [guestHours, setGuestHours] = useState(24),
    [invite, setInvite] = useState<Invite>(),
    [inviting, setInviting] = useState(false),
    [removing, setRemoving] = useState<User>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [expired, setExpired] = useState(false);
  const generation = useRef(0);
  const locked = busy || loading || disabled;
  function failure(e: unknown) {
    if (e instanceof ApiError && e.status === 401) onSessionExpired();
    else setError(e instanceof Error ? e.message : "操作未完成，请重试。");
  }
  async function load() {
    const id = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const data = await request<{ members: User[] }>("/auth/members");
      if (generation.current === id) {
        setMembers(data.members);
        setLoaded(true);
      }
    } catch (e) {
      if (generation.current === id) failure(e);
    } finally {
      if (generation.current === id) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, []);
  useEffect(() => {
    setExpired(!!invite && invite.expiresAt <= Date.now());
    if (!invite) return;
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(0, invite.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [invite]);
  async function createInvite() {
    if (locked) return;
    setBusy(true);
    setError("");
    setInvite(undefined);
    try {
      const result = await request<{ code: string; expiresAt: number }>(
        "/auth/invitations",
        "POST",
        { role, guestHours },
      );
      setInvite({ ...result, role, guestHours });
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!removing || locked) return;
    setBusy(true);
    setError("");
    try {
      await request(
        "/auth/members/" + encodeURIComponent(removing.id),
        "DELETE",
        {},
      );
      setRemoving(undefined);
      await load();
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
    }
  }
  const invitation = (
    <section className="panel settings-invite">
      <header>
        <h2>邀请加入家庭</h2>
        {mobile && (
          <Button
            disabled={busy}
            icon={<ArrowLeft size={16} />}
            onClick={() => {
              setInviting(false);
              setInvite(undefined);
            }}
          >
            返回成员
          </Button>
        )}
      </header>
      <fieldset disabled={locked}>
        <label>
          邀请身份
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value as "member" | "guest");
              setInvite(undefined);
            }}
          >
            <option value="member">家庭成员</option>
            <option value="guest">限时访客</option>
          </select>
        </label>
        <p className="settings-role-note">{roleDetails[role]}</p>
        {role === "guest" && (
          <label>
            访客访问时长
            <select
              value={guestHours}
              onChange={(e) => {
                setGuestHours(Number(e.target.value));
                setInvite(undefined);
              }}
            >
              {[1, 24, 168].map((h) => (
                <option key={h} value={h}>
                  {guestAccessText(h)}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="settings-muted">
          邀请码 15 分钟内有效，仅使用一次。
          {role === "guest"
            ? "访问时长从对方成功加入时开始计算。"
            : "成员访问没有预设到期时间。"}
        </p>
        <Button
          type="primary"
          loading={busy}
          onClick={() => void createInvite()}
        >
          生成邀请码
        </Button>
      </fieldset>
      {invite && (
        <div
          className={"settings-invite-result" + (expired ? " expired" : "")}
          role="status"
        >
          <strong>
            {roleNames[invite.role]}邀请
            {invite.role === "guest"
              ? " · " + guestAccessText(invite.guestHours)
              : ""}
          </strong>
          {expired ? (
            <p>此邀请码已过期，请重新生成。</p>
          ) : (
            <>
              <p className="settings-code" aria-label="一次性邀请码">
                {invite.code}
              </p>
              <p>
                {formatTime(new Date(invite.expiresAt).toISOString())} 前有效
              </p>
            </>
          )}
          {!expired && <small>请让对方在登录页选择“加入家庭”。</small>}
          <Button onClick={() => setInvite(undefined)}>隐藏邀请码</Button>
        </div>
      )}
    </section>
  );
  return (
    <div className="settings-members">
      {(!mobile || !inviting) && (
        <div className="settings-member-heading">
          <div>
            <div className="settings-member-title">
              <h2>家庭成员与访客</h2>
              <Button type="text" shape="circle" size="small" aria-label="查看身份权限范围" title="身份权限说明" icon={<CircleHelp size={17} />} onClick={onShowPermissions} />
            </div>
            <p className="settings-muted">
              {loaded
                ? `${members.length} 位成员 · 上次刷新`
                : "正在读取成员名单…"}
            </p>
          </div>
          <div className="settings-actions">
            <Button
              icon={<RefreshCw size={16} />}
              disabled={locked}
              onClick={() => void load()}
            >
              刷新
            </Button>
            {mobile && (
              <Button
                type="primary"
                icon={<UserPlus size={16} />}
                disabled={locked}
                onClick={() => setInviting(true)}
              >
                邀请
              </Button>
            )}
          </div>
        </div>
      )}
      {error && (
        <div role="alert" className="settings-error">
          <p>{error}</p>
          {!busy && (
            <Button disabled={disabled || loading} onClick={() => void load()}>
              重新读取成员
            </Button>
          )}
        </div>
      )}
      <div className="settings-member-grid">
        {(!mobile || !inviting) && (
          <section className="panel settings-member-list" aria-busy={loading}>
            <h3>成员名单</h3>
            {loading && (
              <p role="status" className="settings-muted">
                {loaded ? "正在更新，暂时显示上次读取的名单…" : "正在加载…"}
              </p>
            )}
            {!loading && !loaded ? (
              <p className="settings-muted">名单暂不可用，请重试。</p>
            ) : (
              <ul>
                {members.map((member) => (
                  <li key={member.id}>
                    <span className="settings-avatar">
                      {member.displayName.slice(0, 1)}
                    </span>
                    <div>
                      <strong>
                        {member.displayName}
                        {member.id === currentUserId && <small>你</small>}
                      </strong>
                      <span>@{member.username}</span>
                      <p>
                        <ShieldCheck size={14} />
                        {roleNames[member.role]}
                      </p>
                      {member.accessExpiresAt && (
                        <small>
                          访问至{" "}
                          {formatTime(
                            new Date(member.accessExpiresAt).toISOString(),
                          )}
                        </small>
                      )}
                    </div>
                    {member.role !== "admin" && (
                      <Button
                        status="danger"
                        disabled={locked}
                        onClick={() => setRemoving(member)}
                      >
                        移除
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {(!mobile || inviting) && invitation}
      </div>
      <Modal
        visible={!!removing}
        title="移除家庭访问权限"
        onCancel={() => {
          if (!busy) setRemoving(undefined);
        }}
        onOk={() => void remove()}
        confirmLoading={busy}
        okButtonProps={{ disabled: disabled || loading }}
        cancelButtonProps={{ disabled: busy }}
        okText="确认移除"
        cancelText="保留成员"
      >
        <p>
          移除“{removing?.displayName}
          ”后，其当前登录和家庭访问权限立即失效。再次加入需要新的邀请。
        </p>
        {error && (
          <p role="alert" className="settings-error">
            {error}
          </p>
        )}
      </Modal>
    </div>
  );
}
