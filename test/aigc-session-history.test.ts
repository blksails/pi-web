/**
 * examples/aigc-agent · 历史会话侧栏(sidebarLeft)纯逻辑自检。
 *
 * 只测两个不依赖 DOM 的判断点——它们是复刻里唯一**新造**的逻辑,其余(列表渲染 / 菜单)照源项目:
 *  - `sessionHref`:webext 不知道宿主的会话路由形态,靠「地址里出现当前 id 就原位换成目标 id」
 *    自适应 `/session/<id>`、`/c/<id>`、`?session=<id>` 等各家形态;没有当前 id 才退 `?sessionId=`。
 *  - `cleanTitle`:自动标题常是工具入参 JSON / `Text → image:` 包装,需抽出人话再截断(逻辑与
 *    源项目 `components/session-history.tsx` 一致)。
 */
import { describe, expect, it } from "vitest";
import {
  cleanTitle,
  sessionHref,
} from "@/examples/aigc-agent/.pi/web/session-history.js";

const item = (name?: string) => ({
  sessionId: "abcdef123456",
  cwd: "/w",
  createdAt: "2026-07-27T00:00:00.000Z",
  ...(name !== undefined ? { name } : {}),
});

describe("sessionHref", () => {
  it("原位替换路径段形态的会话 id", () => {
    expect(sessionHref("new1", "old1", "https://h/session/old1?tab=x")).toBe(
      "https://h/session/new1?tab=x",
    );
    expect(sessionHref("new1", "old1", "https://h/c/old1")).toBe("https://h/c/new1");
  });

  it("原位替换 query 形态的会话 id", () => {
    expect(sessionHref("new1", "old1", "https://h/?session=old1")).toBe(
      "https://h/?session=new1",
    );
  });

  it("地址里没有当前 id(或尚无当前会话)→ 退到 ?sessionId=", () => {
    expect(sessionHref("new1", undefined, "https://h/chat")).toBe(
      "https://h/chat?sessionId=new1",
    );
    expect(sessionHref("new1", "", "https://h/chat")).toBe("https://h/chat?sessionId=new1");
    expect(sessionHref("new1", "absent", "https://h/chat")).toBe(
      "https://h/chat?sessionId=new1",
    );
  });
});

describe("cleanTitle", () => {
  it("未命名 → 会话 id 前 6 位", () => {
    expect(cleanTitle(item())).toBe("未命名会话 · abcdef");
    expect(cleanTitle(item("  "))).toBe("未命名会话 · abcdef");
  });

  it("抽出工具入参 JSON 里的 prompt", () => {
    expect(cleanTitle(item('{"prompt":"国潮海报","size":"1024x1024"}'))).toBe("国潮海报");
  });

  it("剥掉 `Text → image:` 包装", () => {
    expect(cleanTitle(item("Text → image: 一只猫"))).toBe("一只猫");
  });

  it("超长截断到 38 字 + 省略号", () => {
    expect(cleanTitle(item("字".repeat(50)))).toBe(`${"字".repeat(38)}…`);
  });
});
