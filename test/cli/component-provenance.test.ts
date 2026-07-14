// @vitest-environment node
/**
 * 溯源与安装态判定单测(spec cli-component-add,任务 2.3,Req 5.2, 7.1–7.4)。
 * 五态穷举:fresh / unmanaged / modified(改动+缺失)/ clean-same / clean-new。
 * 判定纯函数经注入的 destExists/readFile,不触真实文件系统。
 */
import { describe, expect, it } from "vitest";
import {
  COMPONENT_PROVENANCE_FILENAME,
  classifyInstallState,
  parseProvenance,
  sha256Hex,
  type ComponentProvenance,
} from "@/server/cli/component/provenance";

const enc = new TextEncoder();

function fakeFs(files: Record<string, Uint8Array | string>): {
  destExists: (d: string) => boolean;
  readFile: (d: string, rel: string) => Uint8Array | null;
} {
  return {
    destExists: () => true,
    readFile: (_d, rel) => {
      const v = files[rel];
      if (v === undefined) return null;
      return typeof v === "string" ? enc.encode(v) : v;
    },
  };
}

function provenanceFor(files: Record<string, string>, version = "1.0.0"): ComponentProvenance {
  const digests: Record<string, string> = {};
  for (const [rel, text] of Object.entries(files)) digests[rel] = sha256Hex(enc.encode(text));
  return { id: "c", version, origin: "local:/x", installedAt: "2026-07-09T00:00:00Z", files: digests };
}

describe("sha256Hex / parseProvenance", () => {
  it("摘要带 sha256: 前缀且确定性", () => {
    const d = sha256Hex(enc.encode("abc"));
    expect(d).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(sha256Hex(enc.encode("abc"))).toBe(d);
  });
  it("坏 JSON / 缺字段 / files 值非字符串均返回 null", () => {
    expect(parseProvenance("{oops")).toBeNull();
    expect(parseProvenance(JSON.stringify({ id: "a", version: "1" }))).toBeNull();
    expect(
      parseProvenance(
        JSON.stringify({ id: "a", version: "1", origin: "o", installedAt: "t", files: { x: 1 } }),
      ),
    ).toBeNull();
  });
});

describe("classifyInstallState 五态穷举", () => {
  const src = { "watermark.tsx": "export const a = 1;\n" };

  it("落点不存在 → fresh(7.1 前置)", () => {
    const state = classifyInstallState("/dest", { version: "1.0.0" }, {
      destExists: () => false,
      readFile: () => null,
    });
    expect(state.state).toBe("fresh");
  });

  it("目录在但无溯源 → unmanaged(7.4)", () => {
    const state = classifyInstallState("/dest", { version: "1.0.0" }, fakeFs({}));
    expect(state.state).toBe("unmanaged");
  });

  it("溯源不可解析 → unmanaged(7.4,不猜)", () => {
    const state = classifyInstallState(
      "/dest",
      { version: "1.0.0" },
      fakeFs({ [COMPONENT_PROVENANCE_FILENAME]: "{broken" }),
    );
    expect(state.state).toBe("unmanaged");
  });

  it("全一致且版本相同 → clean-same-version(7.2)", () => {
    const prov = provenanceFor(src, "1.0.0");
    const state = classifyInstallState(
      "/dest",
      { version: "1.0.0" },
      fakeFs({ [COMPONENT_PROVENANCE_FILENAME]: JSON.stringify(prov), ...src }),
    );
    expect(state.state).toBe("clean-same-version");
  });

  it("全一致且版本不同(升或降)→ clean-new-version(7.1)", () => {
    const prov = provenanceFor(src, "1.0.0");
    for (const incoming of ["1.1.0", "0.9.0"]) {
      const state = classifyInstallState(
        "/dest",
        { version: incoming },
        fakeFs({ [COMPONENT_PROVENANCE_FILENAME]: JSON.stringify(prov), ...src }),
      );
      expect(state.state).toBe("clean-new-version");
    }
  });

  it("内容被改 → modified 携带变更文件表(7.3)", () => {
    const prov = provenanceFor(src, "1.0.0");
    const state = classifyInstallState(
      "/dest",
      { version: "1.1.0" },
      fakeFs({ [COMPONENT_PROVENANCE_FILENAME]: JSON.stringify(prov), "watermark.tsx": "changed" }),
    );
    expect(state.state).toBe("modified");
    if (state.state === "modified") expect(state.changed).toEqual(["watermark.tsx"]);
  });

  it("记录中的文件在落点缺失视同修改(7.3 判定序)", () => {
    const prov = provenanceFor(src, "1.0.0");
    const state = classifyInstallState(
      "/dest",
      { version: "1.0.0" },
      fakeFs({ [COMPONENT_PROVENANCE_FILENAME]: JSON.stringify(prov) }),
    );
    expect(state.state).toBe("modified");
  });
});
