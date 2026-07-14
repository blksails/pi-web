// @vitest-environment node
/**
 * runAdd 编排器集成测试(spec cli-component-add,任务 3.3,
 * Req 6.3, 7.1–7.4, 10.1, 10.2)。
 *
 * 临时目录真实文件系统 + 合成夹具(不依赖范例包):首装 / dry-run 零写入 /
 * 同版 no-op / 本地修改 diff 拒绝 / peer 不满足 + --force / 目标非 source。
 * 断言退出码与稳定错误码呈现(输出经注入 write 捕获)。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAdd } from "@/server/cli/component/add-command";
import { COMPONENT_PROVENANCE_FILENAME } from "@/server/cli/component/provenance";

let root: string;
let pack: string;
let source: string;
let lines: string[];

function write(line: string): void {
  lines.push(line);
}
function output(): string {
  return lines.join("\n");
}

function writePack(version = "0.1.0", body = "export const w = 1;\n"): void {
  mkdirSync(join(pack, "components", "w"), { recursive: true });
  writeFileSync(join(pack, "components", "w", "w.tsx"), body);
  writeFileSync(join(pack, "components", "w", "w.test.tsx"), "// t\n");
  writeFileSync(
    join(pack, "pi-web.json"),
    JSON.stringify({
      id: "demo-w",
      version,
      kind: "component",
      component: {
        files: ["components/w/w.tsx", "components/w/w.test.tsx"],
        wiring: { point: "canvasPlugins", export: "wBundle", from: "./components/w/w" },
        peer: {},
      },
    }),
  );
}

function destDir(): string {
  return join(source, ".pi", "web", "components", "demo-w");
}

async function add(...extra: string[]): Promise<number> {
  return runAdd([pack, "--target", source, ...extra], { cwd: root, write });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-web-add-"));
  pack = join(root, "pack");
  source = join(root, "my-agent");
  mkdirSync(join(source, ".pi", "web"), { recursive: true });
  writeFileSync(join(source, ".pi", "web", "web.config.tsx"), "export default {};\n");
  writePack();
  lines = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runAdd 路径矩阵", () => {
  it("首装成功:文件+溯源落盘、打印接线指引、退出码 0(10.2)", async () => {
    expect(await add()).toBe(0);
    expect(existsSync(join(destDir(), "components/w/w.tsx"))).toBe(true);
    expect(existsSync(join(destDir(), COMPONENT_PROVENANCE_FILENAME))).toBe(true);
    expect(output()).toContain('import { wBundle } from "./components/w/w";');
    expect(output()).toContain("canvasPlugins: [wBundle],");
    expect(output()).toContain("pi-web build");
  });

  it("dry-run:全校验通过、列出文件与指引、零写入、退出码 0(6.1/6.2)", async () => {
    expect(await add("--dry-run")).toBe(0);
    expect(existsSync(destDir())).toBe(false);
    expect(readdirSync(join(source, ".pi", "web"))).toEqual(["web.config.tsx"]);
    expect(output()).toContain("components/w/w.tsx");
    expect(output()).toContain(COMPONENT_PROVENANCE_FILENAME);
    expect(output()).toContain("canvasPlugins: [wBundle],");
  });

  it("dry-run 中校验失败:与真实安装同码、非零退出(6.3)", async () => {
    writeFileSync(join(pack, "pi-web.json"), JSON.stringify({ id: "a", version: "1.0.0", kind: "agent" }));
    expect(await add("--dry-run")).toBe(1);
    expect(output()).toContain("source_not_component");
  });

  it("同版重复 add:no-op、退出码 0(7.2)", async () => {
    expect(await add()).toBe(0);
    const provBefore = readFileSync(join(destDir(), COMPONENT_PROVENANCE_FILENAME), "utf8");
    lines = [];
    expect(await add()).toBe(0);
    expect(output()).toContain("已是该版本");
    expect(readFileSync(join(destDir(), COMPONENT_PROVENANCE_FILENAME), "utf8")).toBe(provBefore);
  });

  it("未改动 + 新版本:覆盖并刷新溯源(7.1)", async () => {
    expect(await add()).toBe(0);
    writePack("0.2.0", "export const w = 2;\n");
    lines = [];
    expect(await add()).toBe(0);
    expect(readFileSync(join(destDir(), "components/w/w.tsx"), "utf8")).toContain("w = 2");
    const prov = JSON.parse(readFileSync(join(destDir(), COMPONENT_PROVENANCE_FILENAME), "utf8")) as {
      version: string;
    };
    expect(prov.version).toBe("0.2.0");
  });

  it("本地改动:打印 unified diff、拒绝覆盖、--force 无效、非零退出(7.3)", async () => {
    expect(await add()).toBe(0);
    writeFileSync(join(destDir(), "components/w/w.tsx"), "export const w = 999; // 本地改\n");
    writePack("0.2.0", "export const w = 2;\n");
    lines = [];
    expect(await add("--force")).toBe(1);
    expect(output()).toContain("component_modified");
    expect(output()).toContain("--- a/components/w/w.tsx");
    expect(output()).toContain("+export const w = 2;");
    // 本地改动原样保留。
    expect(readFileSync(join(destDir(), "components/w/w.tsx"), "utf8")).toContain("999");
  });

  it("落点被非本安装器内容占用 → dest_unmanaged(7.4)", async () => {
    mkdirSync(destDir(), { recursive: true });
    writeFileSync(join(destDir(), "stray.txt"), "x");
    expect(await add()).toBe(1);
    expect(output()).toContain("dest_unmanaged");
  });

  it("peer 不满足:硬失败列全部项;--force 降级继续(4.2/4.3)", async () => {
    writeFileSync(
      join(pack, "pi-web.json"),
      JSON.stringify({
        id: "demo-w",
        version: "0.1.0",
        kind: "component",
        component: {
          files: ["components/w/w.tsx", "components/w/w.test.tsx"],
          wiring: { point: "canvasPlugins", export: "wBundle", from: "./components/w/w" },
          peer: { "ghost-a": ">=1.0.0", "ghost-b": "^2.0.0" },
        },
      }),
    );
    expect(await add()).toBe(1);
    expect(output()).toContain("peer_unsatisfied");
    expect(output()).toContain("ghost-a");
    expect(output()).toContain("ghost-b");
    expect(existsSync(destDir())).toBe(false);

    lines = [];
    expect(await add("--force")).toBe(0);
    expect(output()).toContain("警告");
    expect(existsSync(destDir())).toBe(true);
  });

  it("目标缺 .pi/web/ → target_not_agent_source(3.2)", async () => {
    const notSource = join(root, "plain-dir");
    mkdirSync(notSource, { recursive: true });
    expect(await runAdd([pack, "--target", notSource], { cwd: root, write })).toBe(1);
    expect(output()).toContain("target_not_agent_source");
  });

  it("--help 打印用法,退出码 0;缺位置参报 invalid_arguments(10.1)", async () => {
    expect(await runAdd(["--help"], { cwd: root, write })).toBe(0);
    expect(output()).toContain("pi-web add <source>");
    lines = [];
    expect(await runAdd([], { cwd: root, write })).toBe(1);
    expect(output()).toContain("invalid_arguments");
  });
});
