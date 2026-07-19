/**
 * 集成:per-source settings 运行期实时下发的 PUT→活跃会话广播桥(spec:
 * source-settings-and-slots,任务 7.2,通道 b;Requirements 7.1/7.2)。
 *
 * 覆盖 `session/settings-live-broadcast.ts` 的 `resolveSessionSourceKey`/
 * `broadcastSettingsChanged`:按 `PiSession.policySource` 反查 sourceKey,匹配到目标
 * sourceKey 的活跃会话才收到帧,其余会话(sourceKey 不匹配 / 非 active)被跳过。
 *
 * 真实磁盘 fixture(与装配期注入 3.1 的集成测试同一批 fixture 目录:
 * `test/runner/fixtures/settings-assembly-*-e2e-agent`)而非 mock `resolvePiPlugin`——
 * 保证「HTTP 端点 sourceKey ⇄ 会话 policySource 反查 sourceKey」用的是与生产路径完全
 * 一致的匹配逻辑(拍板 Q2 的单一事实来源),不是被测代码自证。不需要真实 spawn 子进程
 * (装配期注入 3.1 才需要):本机制只依赖磁盘上的 `pi-web.json` 清单,`resolvePiPlugin`
 * 本身是纯读盘操作。
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SseFrame } from "@blksails/pi-web-protocol";
import { PiSession } from "../../src/session/pi-session.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import {
  broadcastSettingsChanged,
  resolveSessionSourceKey,
} from "../../src/session/settings-live-broadcast.js";
import { sourceKey } from "../../src/source-key.js";
import { MockChannel } from "../session/mock-channel.js";
import { makeResolved } from "../session/fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "runner", "fixtures");
const SOURCE_FIXTURE = join(fixturesDir, "settings-assembly-source-e2e-agent");
const PROJECT_FIXTURE = join(fixturesDir, "settings-assembly-project-e2e-agent");
const SOURCE_FIXTURE_SK = sourceKey("settings-assembly-source-e2e-agent");
const PROJECT_FIXTURE_SK = sourceKey("settings-assembly-project-e2e-agent");

function newSession(policySource: string | undefined, id: string): PiSession {
  return new PiSession({
    id,
    resolved: makeResolved({ policySource }),
    channel: new MockChannel(),
    idleMs: 0,
  });
}

function settingsChangedFrames(
  frames: SseFrame[],
): Extract<SseFrame, { kind: "control" }>[] {
  return frames.filter(
    (f): f is Extract<SseFrame, { kind: "control" }> =>
      f.kind === "control" && f.payload.control === "settings-changed",
  );
}

describe("resolveSessionSourceKey — 按 policySource 反查 sourceKey(真实磁盘 fixture)", () => {
  it("dir 型 policySource 命中 fixture 清单,反查出与 HTTP 端点一致的 sourceKey", async () => {
    const s = newSession(SOURCE_FIXTURE, "s1");
    await expect(resolveSessionSourceKey(s)).resolves.toBe(SOURCE_FIXTURE_SK);
  });

  it("policySource 未定义 → undefined(无法匹配任何 source)", async () => {
    const s = newSession(undefined, "s1");
    await expect(resolveSessionSourceKey(s)).resolves.toBeUndefined();
  });

  it("policySource 指向不存在的目录 → best-effort 不抛出(resolvePiPlugin 对缺失清单回退 basename id,产出与任何真实 fixture 都不同的 sourceKey,不会误配)", async () => {
    const s = newSession(join(fixturesDir, "does-not-exist-agent"), "s1");
    const key = await resolveSessionSourceKey(s);
    expect(key).toBeDefined();
    expect(key).not.toBe(SOURCE_FIXTURE_SK);
    expect(key).not.toBe(PROJECT_FIXTURE_SK);
  });
});

describe("broadcastSettingsChanged — PUT 成功后向匹配 sourceKey 的活跃会话广播(Req 7.1)", () => {
  it("只有 policySource 匹配目标 sourceKey 的活跃会话收到 control:settings-changed 帧", async () => {
    const store = new InMemorySessionStore(true);
    const matching = newSession(SOURCE_FIXTURE, "matching");
    const other = newSession(PROJECT_FIXTURE, "other");
    const noPolicySource = newSession(undefined, "no-policy-source");
    store.create(matching);
    store.create(other);
    store.create(noPolicySource);

    const matchingFrames: SseFrame[] = [];
    const otherFrames: SseFrame[] = [];
    const noPolicySourceFrames: SseFrame[] = [];
    matching.subscribe((f) => matchingFrames.push(f));
    other.subscribe((f) => otherFrames.push(f));
    noPolicySource.subscribe((f) => noPolicySourceFrames.push(f));

    await broadcastSettingsChanged(store, SOURCE_FIXTURE_SK, {
      values: { apiBase: "https://example.test" },
      liveReloadKeys: ["notifyEmail"],
    });

    const matched = settingsChangedFrames(matchingFrames);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.payload).toMatchObject({
      control: "settings-changed",
      sourceKey: SOURCE_FIXTURE_SK,
      values: { apiBase: "https://example.test" },
      liveReloadKeys: ["notifyEmail"],
    });

    expect(settingsChangedFrames(otherFrames)).toHaveLength(0);
    expect(settingsChangedFrames(noPolicySourceFrames)).toHaveLength(0);
  });

  it("迟到订阅者(广播后才 subscribe)经粘性帧回放拿到最近一次下发(Req 7.2)", async () => {
    const store = new InMemorySessionStore(true);
    const matching = newSession(SOURCE_FIXTURE, "matching");
    store.create(matching);

    await broadcastSettingsChanged(store, SOURCE_FIXTURE_SK, {
      values: { apiBase: "v1" },
      liveReloadKeys: [],
    });

    const frames: SseFrame[] = [];
    matching.subscribe((f) => frames.push(f));
    const replayed = settingsChangedFrames(frames);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]?.payload).toMatchObject({ sourceKey: SOURCE_FIXTURE_SK, values: { apiBase: "v1" } });
  });

  it("已停止(非 active)会话被跳过,不抛出、不广播", async () => {
    const store = new InMemorySessionStore(true);
    const matching = newSession(SOURCE_FIXTURE, "matching");
    store.create(matching);
    await matching.stop();

    await expect(
      broadcastSettingsChanged(store, SOURCE_FIXTURE_SK, { values: {}, liveReloadKeys: [] }),
    ).resolves.toBeUndefined();
  });

  it("空 store(无任何活跃会话)广播为 no-op,不抛出", async () => {
    const store = new InMemorySessionStore(true);
    await expect(
      broadcastSettingsChanged(store, SOURCE_FIXTURE_SK, { values: {}, liveReloadKeys: [] }),
    ).resolves.toBeUndefined();
  });
});
