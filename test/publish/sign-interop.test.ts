/**
 * ★ 签名 ↔ 验签**端到端互通**(spec publish-key-lifecycle,Req 5.5)。
 *
 * 为什么必须有这一条:密钥的生成在 pi-web(keystore),验签在 registry。两侧各测各的
 * **测不出形态不一致** —— base64 与 base64url 混用、raw 与 JWK 混用、指纹算错,
 * 每一种都会表现为"签出来的验不过",且极难定位(它不在任一侧的单测里)。
 *
 * 这条断言把两侧串起来:**keystore 生成的密钥签出的 manifest,registry 的纯函数能验过,
 * 且 manifest.publisher 恰好是该公钥的指纹**(指纹反查 publisher 是归属判定的依据)。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeFingerprint, verifyManifest } from "@pi-clouds/registry-client";
import { ensurePublishKey } from "@/server/cli/publish/keystore";
import { compile, sign } from "@/server/cli/publish/manifest-compiler";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
function scratch(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function makePkg(): string {
  const d = scratch("pi-interop-pkg-");
  writeFileSync(
    join(d, "pi-web.json"),
    JSON.stringify({ id: "acme/interop", version: "1.0.0", kind: "plugin" }, null, 2),
  );
  writeFileSync(join(d, "index.ts"), "// interop fixture\n");
  return d;
}

describe("keystore 生成的密钥能签、且签出的能被 registry 验过", () => {
  it("★ verifyManifest 通过,且 publisher 指纹与公钥对应", async () => {
    const home = scratch("pi-interop-home-");
    const key = ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: home });
    if (!key.ok) throw new Error("keystore failed");

    const compiled = await compile(makePkg());
    if (!compiled.ok) throw new Error(`compile failed: ${JSON.stringify(compiled.error)}`);

    // ★ sign() 直接从**文件**读私钥(keystore 不经手私钥),这正是生产路径。
    const signed = sign(compiled.value, key.value.path);
    if (!signed.ok) throw new Error(`sign failed: ${JSON.stringify(signed.error)}`);

    expect(verifyManifest(signed.value, key.value.publicKey)).toBe(true);
    expect(signed.value["publisher"]).toBe(computeFingerprint(key.value.publicKey));
    // keystore 自报的指纹与 manifest 里写的必须是同一个 —— 否则登记的钥匙对不上签名。
    expect(signed.value["publisher"]).toBe(key.value.fingerprint);
  });

  it("★ 反向性质:换一把公钥去验,必须验不过(证明上一条不是恒真)", async () => {
    const homeA = scratch("pi-interop-a-");
    const homeB = scratch("pi-interop-b-");
    const a = ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: homeA });
    const b = ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: homeB });
    if (!a.ok || !b.ok) throw new Error("keystore failed");

    const compiled = await compile(makePkg());
    if (!compiled.ok) throw new Error("compile failed");
    const signed = sign(compiled.value, a.value.path);
    if (!signed.ok) throw new Error("sign failed");

    expect(verifyManifest(signed.value, b.value.publicKey)).toBe(false);
  });

  it("复用既有密钥签出的结果与首次一致(复用没有偷偷换钥)", async () => {
    const home = scratch("pi-interop-reuse-");
    const first = ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: home });
    const second = ensurePublishKey({ env: {} as NodeJS.ProcessEnv, homeDir: home });
    if (!first.ok || !second.ok) throw new Error("keystore failed");

    const dir = makePkg();
    const compiled = await compile(dir);
    if (!compiled.ok) throw new Error("compile failed");
    const s1 = sign(compiled.value, first.value.path);
    const s2 = sign(compiled.value, second.value.path);
    if (!s1.ok || !s2.ok) throw new Error("sign failed");
    // Ed25519 是确定性签名:同密钥同字节 → 同签名。不同则说明复用取到了另一把钥匙。
    expect(s1.value["signature"]).toBe(s2.value["signature"]);
    // 顺带钉住:磁盘上确实只有一把(复用没有另起文件)。
    expect(JSON.parse(readFileSync(first.value.path, "utf8"))).toEqual(
      JSON.parse(readFileSync(second.value.path, "utf8")),
    );
  });
});
