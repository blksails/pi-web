/**
 * 桌面壳:外链打开决策纯函数单测(spec pi-web-desktop task 2.2,Req 5.4)。
 * setWindowOpenHandler 据此决定「交系统浏览器」还是「仅拒绝」,先校验 scheme/host。
 */
import { describe, it, expect } from "vitest";
import { decideExternalOpen } from "@/desktop/src/external-link";

describe("decideExternalOpen(外链交系统浏览器,先校验 — Req 5.4)", () => {
  it("外部 https 链接 → open-external(交系统默认浏览器)", () => {
    expect(decideExternalOpen("https://example.com/docs")).toBe("open-external");
  });

  it("外部 http 链接 → open-external", () => {
    expect(decideExternalOpen("http://example.org")).toBe("open-external");
  });

  it("本地回环 UI(127.0.0.1 / localhost / ::1)→ deny(不为本地 UI 另开系统浏览器)", () => {
    expect(decideExternalOpen("http://127.0.0.1:3000/chat")).toBe("deny");
    expect(decideExternalOpen("http://localhost:5321/")).toBe("deny");
    expect(decideExternalOpen("http://[::1]:8080/")).toBe("deny");
  });

  it("非 http(s) scheme(file/javascript/data 等)→ deny(安全:openExternal 传不受信输入可致命令执行)", () => {
    expect(decideExternalOpen("file:///etc/passwd")).toBe("deny");
    expect(decideExternalOpen("javascript:alert(1)")).toBe("deny");
    expect(decideExternalOpen("data:text/html,<script>x</script>")).toBe("deny");
  });

  it("非法/无法解析的 url → deny(不抛错,安全兜底)", () => {
    expect(decideExternalOpen("not a url")).toBe("deny");
    expect(decideExternalOpen("")).toBe("deny");
  });
});
