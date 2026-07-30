/**
 * 零声明者核验的守卫测试(spec panes-only-right-panel 任务 5.1;Req 1.4/1.5/7.3/7.4)。
 *
 * ## 本文件此刻的状态是**刻意的**
 *
 * 迁移尚未完成,仓里还有 9 个声明者,故「零残留」那条断言现在**不成立**。它被标记为
 * 待启用(见文件末尾),等任务 5.2 删除完成后翻开 —— 那时它才是有意义的常驻守卫。
 *
 * 现在能测、也必须测的是**核验本身有没有判别力**:
 * 「正确地没有了」与「核验根本没在工作」在观察上同形。若不先证明它能报红,
 * 将来删完之后看到的绿是没有信息量的。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPanelRightDeclarations } from "../../scripts/check-no-panel-right.js";

/** 造一个最小仓库骨架,用来验核验器本身。 */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "panelright-guard-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return root;
}

describe("★ 核验器的判别力(先证明它能报红)", () => {
  it("★ 植入一处声明 → 报红并给出位置", () => {
    const root = fixture({
      "packages/web-kit/src/slots.ts": 'export const SLOTS = {\n  panelRight: "panelRight",\n};\n',
    });
    try {
      const hits = findPanelRightDeclarations(root);
      // 报红是第一位的;能定位到行是第二位的(否则删的人不知道该改哪)。
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]?.file).toBe("packages/web-kit/src/slots.ts");
      expect(hits[0]?.line).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("★ 移除后转绿(证明红不是恒红)", () => {
    const root = fixture({
      "packages/web-kit/src/slots.ts": 'export const SLOTS = {\n  sidebarLeft: "sidebarLeft",\n};\n',
    });
    try {
      expect(findPanelRightDeclarations(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("同一文件多处残留全部列出(不是找到一个就停)", () => {
    const root = fixture({
      "a.ts": 'const x = "panelRight";\nconst y = 1;\nconst z = { panelRight: 2 };\n',
    });
    try {
      expect(findPanelRightDeclarations(root)).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("注释里的残留同样算(它意味着心智模型还停在旧机制)", () => {
    const root = fixture({ "a.ts": "// 旧的 panelRight 槽已废弃\n" });
    try {
      expect(findPanelRightDeclarations(root)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("扫描范围", () => {
  it("★ 跳过产物与依赖目录(否则永远红在别人的代码上)", () => {
    const root = fixture({
      "node_modules/pkg/index.js": 'exports.panelRight = 1;\n',
      "dist/bundle.js": 'var panelRight = 1;\n',
      ".pi/web/dist/web-extension.mjs": 'panelRight\n',
      "src/ok.ts": "export const a = 1;\n",
    });
    try {
      expect(findPanelRightDeclarations(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("★ 白名单只放行文档与核验自身,产品代码一律不放行", () => {
    const root = fixture({
      ".kiro/specs/x/design.md.ts": 'panelRight\n',        // 文档(扩展名凑扫描规则)
      "scripts/check-no-panel-right.ts": 'const NEEDLE = "panelRight";\n',
      "packages/ui/src/chat/pi-chat.tsx": 'slots.panelRight\n', // 产品代码 —— 必须被抓
    });
    try {
      const hits = findPanelRightDeclarations(root);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.file).toBe("packages/ui/src/chat/pi-chat.tsx");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("非源码扩展名不扫(避免锁文件之类的噪声)", () => {
    const root = fixture({ "notes.md": "panelRight\n", "a.lock": "panelRight\n" });
    try {
      expect(findPanelRightDeclarations(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("真实仓库的当前状态", () => {
  it("★ 现在**应当**报红 —— 迁移未完成,9 个声明者还在", () => {
    // 这条断言的方向会在任务 5.2 删除完成后**反转**为「必须为空」。
    // 现在断言「非空」不是凑数:它证明核验器接在了真实仓库上、扫描范围没被过度收窄
    // (跳过目录列表写宽一点点,就会静默地什么都扫不到)。
    const hits = findPanelRightDeclarations(process.cwd());
    expect(hits.length).toBeGreaterThan(0);
    // 至少应抓到契约定义处 —— 抓不到就说明扫描范围有问题。
    expect(hits.some((h) => h.file.includes("packages/web-kit/src/slots.ts"))).toBe(true);
  });
});

/*
 * 待启用(任务 5.2 删除完成后翻开,并删除上面那条「应当报红」的用例):
 *
 * it("零声明者:全仓无残留", () => {
 *   const hits = findPanelRightDeclarations(process.cwd());
 *   expect(hits, hits.map((h) => `${h.file}:${h.line}`).join("\n")).toEqual([]);
 * });
 */
