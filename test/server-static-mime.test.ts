/**
 * `serveStatic` 的 content-type 映射。
 *
 * 走**真实的 `serveStatic` 路径**（经 `PI_WEB_CLIENT_DIR` 指向临时目录），而不是去断言
 * 那张 MIME 表长什么样 —— 后者只会复述实现，测不出「响应头到底是什么」。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serveStatic } from "../server/static.js";

let clientDir: string;
let prevEnv: string | undefined;

beforeEach(() => {
  clientDir = mkdtempSync(join(tmpdir(), "pi-web-static-"));
  prevEnv = process.env.PI_WEB_CLIENT_DIR;
  process.env.PI_WEB_CLIENT_DIR = clientDir;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.PI_WEB_CLIENT_DIR;
  else process.env.PI_WEB_CLIENT_DIR = prevEnv;
  rmSync(clientDir, { recursive: true, force: true });
});

const write = (rel: string, body: string) => {
  const abs = join(clientDir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body);
};

describe("serveStatic 的 content-type", () => {
  it("PWA 清单是 application/manifest+json，而非 octet-stream", async () => {
    write("site.webmanifest", '{"name":"Pi-Web"}');
    const res = await serveStatic("/site.webmanifest");
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toBe("application/manifest+json");
    expect(await res?.text()).toBe('{"name":"Pi-Web"}');
  });

  it.each([
    ["favicon.ico", "image/x-icon"],
    ["favicon-32x32.png", "image/png"],
    ["index.css", "text/css; charset=utf-8"],
    ["app.js", "text/javascript; charset=utf-8"],
  ])("%s → %s", async (name, expected) => {
    write(name, "x");
    const res = await serveStatic(`/${name}`);
    expect(res?.headers.get("content-type")).toBe(expected);
  });

  it("未知扩展名退回 octet-stream（不猜）", async () => {
    write("blob.bin", "x");
    const res = await serveStatic("/blob.bin");
    expect(res?.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("清单不进长缓存（只有 /assets/ 下的指纹资源才 immutable）", async () => {
    write("site.webmanifest", "{}");
    const res = await serveStatic("/site.webmanifest");
    expect(res?.headers.get("cache-control")).toBe("no-store");
  });
});
