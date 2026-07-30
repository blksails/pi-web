import { describe, it, expect } from "vitest";
import {
  packageIdFromSpec,
  packageInstallDir,
  resolveInPackage,
} from "../../src/config/package-install-path.js";

const AGENT = "/agent";

describe("packageIdFromSpec", () => {
  it("剥前缀与版本/ref,保留作用域", () => {
    expect(packageIdFromSpec("npm:pi-mcp-adapter@1.0.0")).toBe("pi-mcp-adapter");
    expect(packageIdFromSpec("npm:@aizigao/pi-proxy-fetch@1.0.2")).toBe("@aizigao/pi-proxy-fetch");
    expect(packageIdFromSpec("npm:pi-sandbox")).toBe("pi-sandbox");
    expect(packageIdFromSpec("git:github.com/o/r@v1")).toBe("github.com/o/r");
    expect(packageIdFromSpec("pi-bare")).toBe("pi-bare");
  });
});

describe("packageInstallDir", () => {
  it("npm 落 node_modules(去版本,保留作用域)", () => {
    expect(packageInstallDir("npm:pi-mcp-adapter@1.0.0", AGENT)).toBe(
      "/agent/npm/node_modules/pi-mcp-adapter",
    );
    expect(packageInstallDir("npm:@aizigao/pi-proxy-fetch@1.0.2", AGENT)).toBe(
      "/agent/npm/node_modules/@aizigao/pi-proxy-fetch",
    );
  });
  it("git 落 git/<host>/<path>(去 ref)", () => {
    expect(packageInstallDir("git:github.com/o/r@v1", AGENT)).toBe("/agent/git/github.com/o/r");
  });
  it("local 取绝对路径原样;非绝对返回 undefined", () => {
    expect(packageInstallDir("local:/abs/pkg", AGENT)).toBe("/abs/pkg");
    expect(packageInstallDir("local:rel", AGENT)).toBeUndefined();
  });

  it("npm/git 路径穿越逃逸 agentDir → undefined(H1)", () => {
    expect(packageInstallDir("git:../../etc", AGENT)).toBeUndefined();
    expect(packageInstallDir("git:github.com/../../../../etc", AGENT)).toBeUndefined();
    expect(packageInstallDir("npm:../../../etc", AGENT)).toBeUndefined();
  });
});

describe("resolveInPackage", () => {
  it("包内相对路径正常拼接;穿越逃逸包目录 → undefined", () => {
    expect(resolveInPackage("/agent/npm/node_modules/pkg", "./schema.json")).toBe(
      "/agent/npm/node_modules/pkg/schema.json",
    );
    expect(resolveInPackage("/agent/npm/node_modules/pkg", "../../../../etc/passwd")).toBeUndefined();
  });
});
