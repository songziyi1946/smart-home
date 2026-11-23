import { ArrowUpRight, House, Layers, LogOut, Moon } from "lucide-react";
import type { State, Mutate } from "../types";

export default function QuickActions({
  state,
  busy,
  mutate,
  limit = 3,
}: {
  state: State;
  busy: boolean;
  mutate: Mutate;
  limit?: number;
}) {
  const running = state.sceneRuns.some((run) => run.status === "running");
  return (
    <section className="panel home-actions" aria-label="常用操作">
      <header className="home-panel-heading">
        <h2>
          <Layers size={19} aria-hidden />
          常用操作
        </h2>
        <a className="home-text-action" href="#scenes">
          全部场景 <ArrowUpRight size={15} aria-hidden />
        </a>
      </header>
      {state.scenes.length ? (
        <div className="home-action-grid">
          {state.scenes.slice(0, limit).map((scene) => {
            const Icon =
              scene.id === "home"
                ? House
                : scene.id === "away"
                  ? LogOut
                  : scene.id === "sleep"
                    ? Moon
                    : Layers;
            const sceneRunning = state.sceneRuns.some(
              (run) => run.sceneId === scene.id && run.status === "running",
            );
            return (
              <button
                key={scene.id}
                title={scene.description || undefined}
                disabled={busy || running}
                onClick={() => void mutate("/scenes/" + scene.id, "POST", {})}
              >
                <Icon size={21} aria-hidden />
                <span>
                  {scene.name}
                  {sceneRunning && <small role="status">执行中…</small>}
                </span>
                <ArrowUpRight size={15} aria-hidden />
              </button>
            );
          })}
        </div>
      ) : (
        <p className="home-actions-empty">暂无场景</p>
      )}
    </section>
  );
}
