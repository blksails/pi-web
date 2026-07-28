/**
 * 公钥自动登记的编排(spec publish-key-lifecycle,Req 2 / 5.3)。
 *
 * ★ 三条要紧的都是**否定式**:
 *   · 无授予 → 不发请求、不写回执;
 *   · 回执命中 → **零网络调用**(幂等短路要真的短路,不是"调了但忽略");
 *   · 失败 → 不写回执(否则会留下"以为登记过了"的假状态,下次真的就不登了)。
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensurePublishKeyRegistered,
  REGISTRATION_RECEIPT_FILENAME,
} from "@/lib/app/publish-key-registration";
import type { PublishKeyInfo } from "@/server/cli/publish/keystore";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), "pi-keyreg-"));
  dirs.push(d);
  return d;
}

const KEY: PublishKeyInfo = {
  path: "/tmp/unused/publish.json",
  publicKey: "PUB",
  fingerprint: "ed25519:FP",
  created: false,
};

function setup(
  overrides: {
    key?: () => ReturnType<typeof okKey>;
    grant?: { publisherId: string } | undefined;
    register?: { ok: true; fingerprint: string; publisherId: string } | { ok: false };
  } = {},
) {
  const dir = scratch();
  const receiptPath = join(dir, REGISTRATION_RECEIPT_FILENAME);
  const registerPublishKey = vi.fn(async () => overrides.register ?? ({ ok: true, fingerprint: "ed25519:FP", publisherId: "pub-1" } as const));
  const getPublishGrant = vi.fn(async () =>
    "grant" in overrides ? overrides.grant : { publisherId: "pub-1" },
  );
  return {
    receiptPath,
    registerPublishKey,
    getPublishGrant,
    deps: {
      ensureKey: overrides.key ?? (() => okKey()),
      getPublishGrant,
      registerPublishKey,
      receiptPath,
      hostLabel: () => "test-host",
    },
  };
}

const okKey = () => ({ ok: true, value: KEY }) as const;

describe("成功路径", () => {
  it("首次 → 发请求并写回执;回执只含指纹与 publisherId", async () => {
    const s = setup();
    expect(await ensurePublishKeyRegistered(s.deps)).toBe("registered");
    expect(s.registerPublishKey).toHaveBeenCalledWith({ publicKey: "PUB", label: "test-host" });
    expect(existsSync(s.receiptPath)).toBe(true);
    const receipt = JSON.parse(readFileSync(s.receiptPath, "utf8")) as Record<string, unknown>;
    expect(receipt).toEqual({ fingerprint: "ed25519:FP", publisherId: "pub-1" });
  });

  it("★ 回执命中 → **零网络调用**(幂等短路),且如实报 already 而非 skipped", async () => {
    const s = setup();
    writeFileSync(s.receiptPath, JSON.stringify({ fingerprint: "ed25519:FP", publisherId: "pub-1" }));
    // ★ 三态的意义就在这条:`already` 表示公钥**已就位**(真实发布据此放行),
    //   若压成布尔 false,发布路径会把"已登记"误判成"没登记"而拒绝。
    expect(await ensurePublishKeyRegistered(s.deps)).toBe("already");
    expect(s.registerPublishKey).not.toHaveBeenCalled();
  });

  it("★ 回执里的 publisherId 与当前授予不符(换了企业)→ 重新登记", async () => {
    const s = setup();
    writeFileSync(s.receiptPath, JSON.stringify({ fingerprint: "ed25519:FP", publisherId: "pub-OLD" }));
    expect(await ensurePublishKeyRegistered(s.deps)).toBe("registered");
    expect(s.registerPublishKey).toHaveBeenCalled();
  });

  it("回执损坏 → 当作没有,重登一次(回执是缓存,坏了可重建 —— 与密钥文件刻意不同)", async () => {
    const s = setup();
    writeFileSync(s.receiptPath, "{ broken");
    expect(await ensurePublishKeyRegistered(s.deps)).toBe("registered");
    expect(s.registerPublishKey).toHaveBeenCalled();
  });
});

describe("不登记的各条路径(全部静默,Req 2.5)", () => {
  it("★ 无发布授予 → 不发请求、不写回执", async () => {
    const s = setup({ grant: undefined });
    expect(await ensurePublishKeyRegistered(s.deps)).toBe("skipped");
    expect(s.registerPublishKey).not.toHaveBeenCalled();
    expect(existsSync(s.receiptPath)).toBe(false);
  });

  it("密钥不可用 → **连授予都不取**(不为一件做不了的事打网络)", async () => {
    const s = setup({ key: () => ({ ok: false, error: { code: "KEY_MALFORMED", path: "/x" } }) as never });
    expect(await ensurePublishKeyRegistered(s.deps)).toBe("skipped");
    expect(s.getPublishGrant).not.toHaveBeenCalled();
    expect(s.registerPublishKey).not.toHaveBeenCalled();
  });

  it("★ 登记失败(如 409 冲突)→ **不写回执**(否则会留下假状态,下次就不再尝试了)", async () => {
    const s = setup({ register: { ok: false } });
    expect(await ensurePublishKeyRegistered(s.deps)).toBe("skipped");
    expect(existsSync(s.receiptPath)).toBe(false);
  });

  it("★ 依赖抛异常 → 返回 skipped 而**不是抛**(本函数对调用方的契约是永不抛)", async () => {
    const s = setup();
    const deps = {
      ...s.deps,
      getPublishGrant: async () => {
        throw new Error("boom");
      },
    };
    await expect(ensurePublishKeyRegistered(deps)).resolves.toBe("skipped");
  });
});

describe("凭据卫生", () => {
  it("回执里不含任何 token 字段(只有可公开物)", async () => {
    const s = setup();
    await ensurePublishKeyRegistered(s.deps);
    const raw = readFileSync(s.receiptPath, "utf8");
    expect(raw).not.toMatch(/token|secret|private/i);
  });
});
