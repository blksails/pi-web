/**
 * examples/aigc-agent · pane 授权面 ↔ guest 实际调用 ↔ agent 供给 三方对齐自检。
 *
 * 为什么值一条测试:这三者对不上时**不会报错,只会静默失灵**——
 *  - guest 发了白名单外的 surface 命令 → PanesHost 的 `authorizePaneRequest` 逐请求拒掉;
 *  - pane 声明了 agent 侧没供给的 route → 宿主转发后 `ROUTE_NOT_FOUND` 404;
 *  - route 方法不相容(声 POST 而 decl 只给 GET)→ 405。
 * 三种都表现为「点了没反应」,查起来很贵。曾真出过一次:目录树 / 归类 / 上传的命令全在
 * 白名单外,功能看着有、实际一条都不通。故把对齐关系钉成确定性闸。
 *
 * canvas pane 的 guest 经 canvas-ui 转发(domain/action 皆为变量),静态抓不到字面量,
 * 其授权面照 examples/panes-agent 的 A 档全集给,不在本测试范围。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { composePaneAgentModules } from "@blksails/pi-web-tool-kit/runtime";
import { aigcPanesDefinition } from "@/examples/aigc-agent/web/panes/index.js";
import { paneModules } from "@/examples/aigc-agent/panes/modules.js";

const PANE_SRC = resolve(__dirname, "..", "examples", "aigc-agent", "web", "panes");

/** 读 guest 源码并剥掉块注释 —— 只对真实调用点断言,不被文档里的示例带偏。 */
function guestSource(file: string): string {
  return readFileSync(resolve(PANE_SRC, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

const paneById = (id: string) => {
  const p = aigcPanesDefinition.panes.find((x) => x.id === id);
  if (p === undefined) throw new Error(`pane ${id} 不在 definition 里`);
  return p;
};

describe("pane 授权面 ↔ guest 实际调用", () => {
  it("materials guest 发的每条 surface 命令都在白名单内", () => {
    const src = guestSource("materials.tsx");
    const used = [
      ...[...src.matchAll(/(?<!surface\.)\brun\("([a-z-]+)"/g)].map((m) => m[1]),
      ...[...src.matchAll(/surface\.run\("materials",\s*"([a-z-]+)"/g)].map((m) => m[1]),
    ];
    expect(used.length).toBeGreaterThan(0);

    const granted = new Set(
      (paneById("materials").capabilities?.surfaceCommands ?? []).flatMap((c) => c.actions ?? []),
    );
    expect([...new Set(used)].filter((a) => !granted.has(a as string))).toEqual([]);
  });

  it("materials guest 请求的每条 route 都在白名单内且方法相符", () => {
    const src = guestSource("materials.tsx");
    const routes = paneById("materials").capabilities?.routes ?? [];
    for (const [, verb, name] of src.matchAll(/\.(query|mutate)\("([a-z-]+)"/g)) {
      const decl = routes.find((r) => r.name === name);
      expect(decl, `route ${String(name)} 未在 materials pane 授权面内`).toBeDefined();
      // query → GET,mutate → POST(panes-kit 的通道语义)。
      expect(decl?.methods ?? ["GET"]).toContain(verb === "query" ? "GET" : "POST");
    }
  });

  it("search guest 请求的 route 同理对齐", () => {
    const src = guestSource("search.tsx");
    const routes = paneById("search").capabilities?.routes ?? [];
    for (const [, verb, name] of src.matchAll(/\.(query|mutate)\("([a-z-]+)"/g)) {
      const decl = routes.find((r) => r.name === name);
      expect(decl, `route ${String(name)} 未在 search pane 授权面内`).toBeDefined();
      expect(decl?.methods ?? ["GET"]).toContain(verb === "query" ? "GET" : "POST");
    }
  });

  it("素材面板既要能上传也要能直送对话 —— 两项能力不可漏授", () => {
    const caps = paneById("materials").capabilities;
    expect(caps?.attachments).toBe("read-write");
    expect(caps?.conversation).toBe("submit");
  });
});

describe("pane 授权面 ↔ agent 侧供给", () => {
  const composed = composePaneAgentModules(paneModules);
  const supplied = new Map(composed.routes.map((r) => [r.name, r.methods ?? ["GET"]]));

  it("每个 pane 声明的 route 都有 agent 侧 handler —— 否则宿主转发即 404", () => {
    for (const pane of aigcPanesDefinition.panes) {
      for (const r of pane.capabilities?.routes ?? []) {
        expect(supplied.has(r.name), `route ${r.name} 无 agent 侧供给`).toBe(true);
        for (const m of r.methods ?? ["GET"]) {
          expect(supplied.get(r.name), `route ${r.name} 不支持 ${m}`).toContain(m);
        }
      }
    }
  });

  it("素材域供给三条只读 route(列表 + 分发状态 + 会话画廊),无任何写路由", () => {
    const materials = paneModules.find((m) => m.pane.id === "materials");
    const names = (materials?.routes ?? []).map((r) => r.name).sort();
    expect(names).toEqual(["assets-list", "material-status", "session-gallery"]);
    for (const r of materials?.routes ?? []) {
      expect(r.methods ?? ["GET"]).toEqual(["GET"]);
    }
  });
});
