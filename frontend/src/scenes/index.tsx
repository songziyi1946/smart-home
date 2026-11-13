import { ChevronRight, House, Layers, LogOut, Moon } from "lucide-react";
import { useState } from "react";
import type { Mutate } from "../types";

export default function Scenes({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: Mutate;
}) {
  const [active, setActive] = useState("");
  return (
    <section className="panel scene-panel">
      <div className="section-heading">
        <h2>
          <Layers />
          一键场景
        </h2>
        <small>让家提前准备好</small>
      </div>
      <div className="scenes">
        {[
          {
            id: "home",
            name: "回家",
            description: "亮起灯光 · 打开窗帘",
            icon: House,
          },
          {
            id: "away",
            name: "离家",
            description: "关闭灯光 · 关闭空调",
            icon: LogOut,
          },
          {
            id: "sleep",
            name: "睡眠",
            description: "留盏床头灯 · 合上窗帘",
            icon: Moon,
          },
        ].map(({ id, name, description, icon: Icon }) => (
          <button
            className={
              "scene-card scene-" + id + (active === id ? " active" : "")
            }
            key={id}
            disabled={busy}
            aria-pressed={active === id}
            onClick={async () => {
              if (await mutate("/scenes/" + id, "POST")) setActive(id);
            }}
          >
            <span className="scene-symbol">
              <Icon />
            </span>
            <strong>{name}</strong>
            <small>{description}</small>
            <ChevronRight className="scene-arrow" size={18} />
          </button>
        ))}
      </div>
    </section>
  );
}
