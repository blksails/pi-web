/**
 * plugin-aggregation 单测(task 3.1,Req 4.1/4.2/4.3/5.1/5.2/5.3)。
 *
 * 覆盖(design「宿主中立注入与聚合」+ 「Allowed Dependencies」类型双向断言 M2 先例):
 * - collectCanvasPluginBundles 纯函数:多扩展提取 + namespace=manifestId;无声明/空数组
 *   剔除(零影响);undefined 入参 → 空;
 * - 车道②(已装包 webext 描述符形态)进聚合断言生效;验签失败包不在 extensions 列表 →
 *   聚合天然不含、不崩;
 * - web-kit CanvasPluginBundle ↔ canvas-kit CanvasPluginBundle 结构断言(capability-type-sync
 *   先例):web-kit 组件位 unknown 宽型是 canvas-kit 具体型的父方向,故断言 canvas-kit 值可赋给
 *   web-kit 型(声明侧安全);聚合输出 bundles 收敛为 canvas-kit canonical 型。
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import type { WebExtension, CanvasPluginBundle as WebKitBundle } from "@blksails/pi-web-kit";
import type { CanvasPluginBundle as KitBundle } from "@blksails/pi-web-canvas-kit";
import {
  collectCanvasPluginBundles,
  type NamespacedPluginBundles,
} from "../src/plugin-aggregation.js";

// ── 测试基建:构造已装载扩展描述符(car道① source 声明 / 车道② 已装包同形)──────
const webExt = (
  manifestId: string,
  canvasPlugins?: readonly WebKitBundle[],
): WebExtension => ({ manifestId, ...(canvasPlugins !== undefined ? { canvasPlugins } : {}) });

const bundle = (id: string, requires?: readonly string[]): WebKitBundle => ({
  id,
  ...(requires !== undefined ? { requires } : {}),
  tools: [{ id: `${id}-tool` }],
  layers: [{ type: `${id}-layer` }],
  actions: [],
});

// ── 类型双向断言(声明侧防漂移;capability-type-sync M2 先例)────────────────────

describe("CanvasPluginBundle 类型镜像(canvas-kit canonical ↔ web-kit 镜像)", () => {
  it("canvas-kit 具体型值可赋给 web-kit 镜像型(窄→宽;声明侧安全,编译期守护)", () => {
    // web-kit 组件位为 unknown(宽),canvas-kit 为具体插件形状(窄);kit 值向 web-kit 型
    // 可赋值,反向不成立(unknown[] 不可窄化为 CanvasTool[])——聚合正是 web-kit→kit 窄化,
    // 运行期安全(作者以 canvas-kit defineXxx 声明,transport 仅擦除为 unknown)。
    expectTypeOf<KitBundle>().toMatchTypeOf<WebKitBundle>();
    // 标量键(id/requires)两侧同形。
    const k: KitBundle = { id: "b", requires: ["x"] };
    const asWeb: WebKitBundle = k;
    expect(asWeb.id).toBe("b");
  });

  it("聚合输出 bundles 收敛为 canvas-kit canonical 型(编译期)", () => {
    const out = collectCanvasPluginBundles([webExt("acme", [bundle("stickers")])]);
    expectTypeOf(out[0]!.bundles).toEqualTypeOf<readonly KitBundle[]>();
  });
});

// ── 纯函数:提取 + 命名空间(4.1/4.2)──────────────────────────────────────────

describe("collectCanvasPluginBundles 提取与命名空间", () => {
  it("多扩展各自提取 canvasPlugins,namespace=manifestId,顺序稳定", () => {
    const out = collectCanvasPluginBundles([
      webExt("acme", [bundle("stickers")]),
      webExt("initech", [bundle("shapes"), bundle("filters")]),
    ]);
    expect(out.map((e) => e.namespace)).toEqual(["acme", "initech"]);
    expect(out[0]!.bundles.map((b) => b.id)).toEqual(["stickers"]);
    expect(out[1]!.bundles.map((b) => b.id)).toEqual(["shapes", "filters"]);
  });

  it("bundles 引用原样透传(仅收窄类型,不拷贝/不 mutate)", () => {
    const b = bundle("stickers", ["acme:stickers-layer"]);
    const out = collectCanvasPluginBundles([webExt("acme", [b])]);
    expect(out[0]!.bundles[0]).toBe(b);
    expect(out[0]!.bundles[0]!.requires).toEqual(["acme:stickers-layer"]);
  });
});

// ── 零影响:无声明 / 空数组 / undefined(4.3/5.3)────────────────────────────────

describe("collectCanvasPluginBundles 零影响剔除", () => {
  it("未声明 canvasPlugins 的扩展被剔除(不产生空 namespace 条目)", () => {
    const out = collectCanvasPluginBundles([
      webExt("no-canvas"),
      webExt("acme", [bundle("stickers")]),
    ]);
    expect(out.map((e) => e.namespace)).toEqual(["acme"]);
  });

  it("canvasPlugins 为空数组的扩展被剔除", () => {
    const out = collectCanvasPluginBundles([webExt("empty", []), webExt("acme", [bundle("s")])]);
    expect(out.map((e) => e.namespace)).toEqual(["acme"]);
  });

  it("undefined 入参 → 空聚合(现状零影响)", () => {
    expect(collectCanvasPluginBundles(undefined)).toEqual([]);
    expect(collectCanvasPluginBundles([])).toEqual([]);
  });
});

// ── 车道②:已装包 webext 描述符 + 验签失败包(5.1/5.2/5.3)──────────────────────

describe("collectCanvasPluginBundles 车道②(已装包 / 验签失败)", () => {
  it("已装包 webext 描述符(含 canvasPlugins)进聚合生效(与车道① 同链)", () => {
    // 模拟包装载产物:第三方插件包的 web 扩展描述符(与 source 自带 defineWebExtension 同形)。
    const installed: WebExtension = {
      manifestId: "third-party-stickers",
      slots: {},
      canvasPlugins: [bundle("stickers", ["third-party-stickers:stickers-layer"])],
    };
    const out = collectCanvasPluginBundles([installed]);
    expect(out).toHaveLength(1);
    expect(out[0]!.namespace).toBe("third-party-stickers");
    expect(out[0]!.bundles[0]!.id).toBe("stickers");
  });

  it("验签失败包不在 extensions 列表 → 聚合天然不含,不崩(缺该 ext 零影响)", () => {
    // 验签失败的包根本不进已装载 extensions 列表(装载链既有容错);聚合只见成功装载者。
    const loaded = [webExt("acme", [bundle("stickers")])]; // 验签失败的 "evil-pkg" 不在其中
    const out = collectCanvasPluginBundles(loaded);
    expect(out.map((e) => e.namespace)).toEqual(["acme"]);
    expect(out.some((e) => e.namespace === "evil-pkg")).toBe(false);
  });
});

// ── 返回形状锚(NamespacedPluginBundles 契约)──────────────────────────────────

describe("NamespacedPluginBundles 契约", () => {
  it("元素 = { namespace, bundles }", () => {
    const out = collectCanvasPluginBundles([webExt("acme", [bundle("s")])]);
    const first: NamespacedPluginBundles = out[0]!;
    expect(Object.keys(first).sort()).toEqual(["bundles", "namespace"]);
  });
});
