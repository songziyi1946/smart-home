import type { ReactNode } from "react";
import { AlertCircle, LoaderCircle, CloudOff, Inbox } from "lucide-react";
export function StatusPanel({
  kind,
  title,
  description,
  onRetry,
  retryLabel = "重试",
  action,
  compact = false,
}: {
  kind: "loading" | "error" | "offline" | "empty";
  title: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  const Icon = {
    loading: LoaderCircle,
    error: AlertCircle,
    offline: CloudOff,
    empty: Inbox,
  }[kind];
  return (
    <section
      className={
        (compact ? "status-compact" : "panel") + " status-panel status-" + kind
      }
      role={kind === "error" ? "alert" : "status"}
      aria-busy={kind === "loading"}
    >
      <span className="status-illustration">
        <Icon aria-hidden size={compact ? 22 : 28} />
      </span>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {onRetry && (
        <button className="quiet-button" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
      {action}
    </section>
  );
}
export function PageSkeleton() {
  return (
    <section
      className="page-skeleton"
      role="status"
      aria-label="正在同步家庭状态"
      aria-busy="true"
    >
      <span className="sr-only">正在同步家庭状态</span>
      {[0, 1, 2].map((i) => (
        <div className="panel skeleton-card" key={i} aria-hidden>
          <i />
          <i />
          <i />
        </div>
      ))}
    </section>
  );
}
