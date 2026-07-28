/**
 * keystore(spec publish-key-lifecycle,Req 1 / 5.1 / 5.2)—— 真实临时目录,不 mock fs。
 *
 * ★ 本文件里最要紧的两条,都是**否定式**断言:
 *   · 已有密钥 → 文件字节**前后完全相同**(覆盖 = 该机器已登记的公钥永久失去对应私钥);
 *   · 坏文件   → 报错且文件字节**不变**(自动重建时用户毫无察觉,这条更险)。
 *   只断言"返回了错误"是不够的 —— 那不排除它已经把文件写坏了。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensurePublishKey,
  resolvePublishKeyPath,
  describeKeystoreError,
  PUBLISH_KEY_PATH_ENV,
} from "@/server/cli/publish/keystore";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), "pi-keystore-"));
  dirs.push(d);
  return d;
}

describe("路径解析(Req 1.1)", () => {
  it("显式 > env > 默认", () => {
    const env = { [PUBLISH_KEY_PATH_ENV]: "/from/env.json" } as NodeJS.ProcessEnv;
    expect(resolvePublishKeyPath({ explicitPath: "/explicit.json", env })).toBe("/explicit.json");
    expect(resolvePublishKeyPath({ env })).toBe("/from/env.json");
    expect(resolvePublishKeyPath({ env: {} as NodeJS.ProcessEnv, homeDir: "/home/u" })).toBe(
      "/home/u/.pi-web/keys/publish.json",
    );
  });

  it("空字符串不算配置(否则 `PI_WEB_PUBLISH_KEY_PATH=` 会把密钥写到空路径)", () => {
    expect(resolvePublishKeyPath({ explicitPath: "", env: {} as NodeJS.ProcessEnv, homeDir: "/h" })).toBe(
      "/h/.pi-web/keys/publish.json",
    );
  });
});

describe("生成(Req 1.1 / 1.2 / 1.3)", () => {
  it("无密钥 → 生成,且形态是 sign() 能读的 {publicKey, privateKey}", () => {
    const home = scratch();
    const r = ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: home });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(true);
    expect(r.value.fingerprint.startsWith("ed25519:")).toBe(true);

    const onDisk = JSON.parse(readFileSync(r.value.path, "utf8")) as Record<string, unknown>;
    expect(Object.keys(onDisk).sort()).toEqual(["privateKey", "publicKey"]);
    expect(typeof onDisk["privateKey"]).toBe("string");
    // 公钥要与返回值一致 —— 否则登记的公钥与实际签名用的私钥不配对,且极难定位。
    expect(onDisk["publicKey"]).toBe(r.value.publicKey);
  });

  it("★ 文件 0600、目录 0700(Req 1.3)", () => {
    const home = scratch();
    const r = ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: home });
    if (!r.ok) throw new Error("expected ok");
    expect(statSync(r.value.path).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, ".pi-web", "keys")).mode & 0o777).toBe(0o700);
  });

  it("★ 私钥不出现在返回值里(Req 1.4 —— 结构性保证,不是纪律)", () => {
    const home = scratch();
    const r = ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: home });
    if (!r.ok) throw new Error("expected ok");
    const priv = (JSON.parse(readFileSync(r.value.path, "utf8")) as { privateKey: string }).privateKey;
    expect(priv.length).toBeGreaterThan(0);
    // 把整个返回值序列化后全文搜索 —— 加字段时若不慎带上私钥,这里立刻红。
    expect(JSON.stringify(r)).not.toContain(priv);
  });
});

describe("复用与不覆盖(Req 1.5 / 1.6)", () => {
  it("★ 已有合法密钥 → 复用,文件字节**完全相同**", () => {
    const home = scratch();
    const first = ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: home });
    if (!first.ok) throw new Error("expected ok");
    const before = readFileSync(first.value.path);

    const second = ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: home });
    if (!second.ok) throw new Error("expected ok");
    expect(second.value.created).toBe(false);
    expect(second.value.publicKey).toBe(first.value.publicKey);
    expect(second.value.fingerprint).toBe(first.value.fingerprint);
    expect(readFileSync(first.value.path).equals(before)).toBe(true);
  });

  it("★ 坏文件(非 JSON)→ KEY_MALFORMED,且文件字节**不变**", () => {
    const home = scratch();
    const path = join(home, ".pi-web", "keys", "publish.json");
    mkdirSync(join(home, ".pi-web", "keys"), { recursive: true });
    writeFileSync(path, "{ not json");
    const before = readFileSync(path);

    const r = ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: home });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("KEY_MALFORMED");
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it("★ 坏文件(JSON 但缺 privateKey)→ KEY_MALFORMED,且文件字节**不变**", () => {
    const home = scratch();
    const path = join(home, ".pi-web", "keys", "publish.json");
    mkdirSync(join(home, ".pi-web", "keys"), { recursive: true });
    writeFileSync(path, JSON.stringify({ publicKey: "abc" }));
    const before = readFileSync(path);

    const r = ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: home });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("KEY_MALFORMED");
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it("坏文件的文案**不提示删除重建**(删了就永久失去已登记公钥的对应私钥)", () => {
    const msg = describeKeystoreError({ code: "KEY_MALFORMED", path: "/x/publish.json" });
    expect(msg).not.toMatch(/删除|重新生成|重建/);
    expect(msg).toContain("/x/publish.json");
  });

  it("写入失败(目标路径的父目录是个文件)→ KEY_WRITE_FAILED 而非抛", () => {
    const home = scratch();
    // 把 keys 造成一个文件,mkdirSync 必失败。
    mkdirSync(join(home, ".pi-web"), { recursive: true });
    writeFileSync(join(home, ".pi-web", "keys"), "i am a file");
    const r = ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: home });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("KEY_WRITE_FAILED");
  });
});

describe("多机多钥是正常状态(Req 4.2)", () => {
  it("两个不同的 home → 两把不同的密钥,互不影响", () => {
    const a = scratch();
    const b = scratch();
    const ka = ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: a });
    const kb = ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: b });
    if (!ka.ok || !kb.ok) throw new Error("expected ok");
    expect(ka.value.fingerprint).not.toBe(kb.value.fingerprint);
    expect(existsSync(ka.value.path) && existsSync(kb.value.path)).toBe(true);
  });
});
