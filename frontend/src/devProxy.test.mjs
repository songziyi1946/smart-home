import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "vite";
import config from "../vite.config.ts";
import { createStateStream } from "../../backend/app/state-stream.mjs";
const express = createRequire(
  new URL("../../backend/package.json", import.meta.url),
)("express");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function within(promise, ms = 1500) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(Error("SSE did not update through the development proxy")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
test(
  "development proxy keeps SSE live beyond REST timeout and propagates upstream disconnects",
  { timeout: 20000 },
  async (t) => {
    let power = true;
    const app = express(),
      responses = new Set();
    const stream = createStateStream({
      snapshot: () => ({
        devices: [{ id: "lamp", state: { online: true, values: { power } } }],
      }),
      sessionFor: () => ({
        user: { id: "test", role: "admin" },
        expiresAt: Infinity,
      }),
    });
    app.use(express.json());
    app.get("/api/events", (req, res) => {
      responses.add(res);
      res.once("close", () => responses.delete(res));
      stream.route(req, res);
    });
    app.patch("/api/devices/lamp", (req, res) => {
      power = req.body.value;
      stream.publish();
      res.json({ accepted: true });
    });
    const upstream = app.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const target = "http://127.0.0.1:" + upstream.address().port;
    let vite;
    const controllers = [];
    t.after(async () => {
      controllers.forEach((c) => c.abort());
      stream.close();
      upstream.closeAllConnections();
      await new Promise((resolve) => upstream.close(resolve));
      await vite?.close();
    });
    vite = await createServer({
      ...config,
      configFile: false,
      root: fileURLToPath(new URL("..", import.meta.url)),
      plugins: [],
      logLevel: "silent",
      server: {
        ...config.server,
        host: "127.0.0.1",
        port: 0,
        watch: null,
        proxy: Object.fromEntries(
          Object.entries(config.server.proxy).map(([key, value]) => [
            key,
            { ...value, target },
          ]),
        ),
      },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    await vite.listen();
    const base = "http://127.0.0.1:" + vite.httpServer.address().port;
    async function open() {
      const controller = new AbortController();
      controllers.push(controller);
      const response = await fetch(base + "/api/events", {
        signal: controller.signal,
      });
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      let buffer = "";
      return {
        reader,
        close: () => controller.abort(),
        async snapshot() {
          for (;;) {
            let end;
            while ((end = buffer.indexOf("\n\n")) >= 0) {
              const frame = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              if (frame.includes("event: snapshot"))
                return JSON.parse(
                  frame
                    .split("\n")
                    .find((l) => l.startsWith("data: "))
                    .slice(6),
                );
            }
            const { value, done } = await reader.read();
            if (done) throw Error("SSE ended");
            buffer += new TextDecoder().decode(value);
          }
        },
      };
    }
    const connection = await open();
    assert.equal(
      (await within(connection.snapshot())).devices[0].state.values.power,
      true,
    );
    // Existing REST proxy timeout was 5 seconds, but the SSE heartbeat is 15 seconds.
    await delay(6100);
    assert.equal(
      (
        await fetch(base + "/api/devices/lamp", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: false }),
        })
      ).status,
      200,
    );
    assert.equal(
      (await within(connection.snapshot())).devices[0].state.values.power,
      false,
    );
    for (const response of responses) response.destroy();
    assert.equal(
      await within(
        connection.reader.read().then(
          (result) => result.done,
          () => true,
        ),
      ),
      true,
    );
    const reconnected = await open();
    assert.equal(
      (await within(reconnected.snapshot())).devices[0].state.values.power,
      false,
    );
    const closed = once([...responses].at(-1), "close");
    reconnected.close();
    await within(closed);
    assert.equal(
      responses.size,
      0,
      "closed browser stream must release upstream subscription",
    );
  },
);
