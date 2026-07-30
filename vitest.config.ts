import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config for app integration + page-render tests.
 *
 * `jsdom` for RTL page-render smoke; resolves `@/` and the raw-TS `@blksails/pi-web-*`
 * packages (the `.js` import specifiers map to `.ts` via vitest's resolver).
 */
export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    // ★ 用**数组**形态而非对象:对象键只能是字符串,而这里必须有一条**正则** alias
    //   (见下方 `.js` → `.ts` 那条)。数组形态按声明顺序匹配,顺序语义与对象一致。
    alias: [
      { find: "@", replacement: path.resolve(__dirname, ".") },
      // 通配深路径:core 声明了 `"./*.js": "./src/*.ts"`,兼容层包经它引用 51 个深路径目标。
      //
      // ★ **必须用正则并显式把 `.js` 换成 `.ts`**。字符串前缀 alias 只做前缀替换,得到
      //   `packages/core/src/trust/index.js` —— 磁盘上不存在,而 vite 的扩展名补全只会去试
      //   `…index.js.ts`,一样落空。包内(server → core)之所以没事:那条路径走的是
      //   **包 exports 映射**而非 alias;到了仓库根 alias 抢先接管,于是同一个 specifier
      //   在两个位置有两种命运 —— 这正是本坑难归因的地方。
      //
      // ★ 它必须排在**下面那几条具名子路径之前**。字符串 `find` 是**前缀匹配**:
      //   `"@blksails/pi-web-core/trust"` 会吞掉 `@blksails/pi-web-core/trust/index.js`,
      //   拼出 `…/trust/index.ts/index.js` 这种四不像。而本条只匹配 `.js` 结尾,
      //   具名子路径都是**无扩展名**导入,故排在前面不会误伤它们。
      {
        find: /^@blksails\/pi-web-core\/(.*)\.js$/,
        replacement: path.resolve(__dirname, "packages/core/src") + "/$1.ts",
      },
      // ★ 具名子路径必须排在裸包名之前:否则被裸名吞掉,且报错与顺序无关、极难定位。
      { find: "@blksails/pi-web-core/testing", replacement: path.resolve(__dirname, "packages/core/src/workspace/testing/index.ts") },
      { find: "@blksails/pi-web-core/trust", replacement: path.resolve(__dirname, "packages/core/src/trust/index.ts") },
      // ⚠ 曾有 `@blksails/pi-web-core/{model-options,vision-model-options}` 两条 alias。
      //   两个取数闭包**值**导入 agent 运行时 SDK(违 R1.3),已摘去兼容层包的 `model-sources`,
      //   内核不再导出它们 —— 留着指向已搬走文件的 alias,比没有 alias 更难排查。
      { find: "@blksails/pi-web-core/", replacement: path.resolve(__dirname, "packages/core/src") + "/" },
      { find: "@blksails/pi-web-core", replacement: path.resolve(__dirname, "packages/core/src/index.ts") },
      // runner 包同规则:`"./*.js": "./src/*.ts"` 通配导出 + 一条 `.mjs` 引导脚本子路径。
      // 顺序与 core 那组逐字同构 —— 正则在最前,具名子路径次之,前缀条与裸名殿后。
      {
        find: /^@blksails\/pi-web-runner\/(.*)\.js$/,
        replacement: path.resolve(__dirname, "packages/runner/src") + "/$1.ts",
      },
      // ★ 这条具名子路径**不能省**:引导脚本是包**根部**的 `.mjs`,不在 `src/` 下。
      //   上面的正则只吃 `.js` 结尾、吃不到它;而下面的前缀条会把它拼成
      //   `packages/runner/src/runner-bootstrap.mjs` —— 磁盘上不存在的位置。
      { find: "@blksails/pi-web-runner/runner-bootstrap.mjs", replacement: path.resolve(__dirname, "packages/runner/runner-bootstrap.mjs") },
      // ★ 裸包名必须用**$ 锚定的正则**,且排在下面那条前缀条之前(实测得出,与 core 那组的
      //   写法不同 —— core 那条字符串裸名条其实是死代码,从未被匹配到)。
      //   原因:vite 的字符串 alias 是朴素前缀匹配,`"@blksails/pi-web-runner/"` 这条会把
      //   **裸** specifier 也吃掉,解析成目录 `packages/runner/src`,再由目录索引找 `index.ts`。
      //   core 恰好有 `src/index.ts` 所以蒙对了;runner 的主入口在 `src/runner/index.ts`,
      //   于是裸名解析失败(实测:目标文件存在也照样 Failed to resolve)。
      //   不能改用字符串裸名条排在前面 —— 朴素前缀匹配会连深路径一起吞掉。
      { find: /^@blksails\/pi-web-runner$/, replacement: path.resolve(__dirname, "packages/runner/src/runner/index.ts") },
      { find: "@blksails/pi-web-runner/", replacement: path.resolve(__dirname, "packages/runner/src") + "/" },
      { find: "@blksails/pi-web-runner", replacement: path.resolve(__dirname, "packages/runner/src/runner/index.ts") },
      // adapters 包:`exports` **只有通配** `"./*.js": "./src/*.ts"`,**没有** `"."` 主入口
      // (未规划 `src/index.ts`),兼容层与装配层一律按深路径消费。故这里**只需一条**正则,
      // 与 core / runner 那两组不同:
      //   ✗ 不加 `$` 锚定的裸名条 —— 没有主入口文件可指,加了就是指向不存在的位置;
      //   ✗ 不加带尾斜杠的前缀条 —— 它是朴素前缀匹配,会把裸 specifier 一起吃掉、解析成
      //     目录 `packages/adapters/src` 再找 `index.ts`(不存在),把「无主入口」这个事实
      //     变成一句含糊的 Failed to resolve;而所有真实导入都带 `.js`,本正则已全覆盖。
      // ⇒ **任何裸包名导入都应当失败,那是正确行为**(与包 `exports` 一致)。
      {
        find: /^@blksails\/pi-web-adapters\/(.*)\.js$/,
        replacement: path.resolve(__dirname, "packages/adapters/src") + "/$1.ts",
      },
      { find: "@blksails/pi-web-logger", replacement: path.resolve(__dirname, "packages/logger/src/index.ts") },
      { find: "@blksails/pi-web-agent-kit", replacement: path.resolve(__dirname, "packages/agent-kit/src/index.ts") },
      { find: "@blksails/pi-web-tool-kit/aigc-canvas-schema", replacement: path.resolve(__dirname, "packages/tool-kit/src/aigc/canvas/schema.ts") },
      { find: "@blksails/pi-web-tool-kit/commands", replacement: path.resolve(__dirname, "packages/tool-kit/src/commands/index.ts") },
      { find: "@blksails/pi-web-tool-kit/extension-entry", replacement: path.resolve(__dirname, "packages/tool-kit/src/extension-tools/entry-path.ts") },
      { find: "@blksails/pi-web-tool-kit/auto-title-entry", replacement: path.resolve(__dirname, "packages/tool-kit/src/auto-title/entry-path.ts") },
      { find: "@blksails/pi-web-tool-kit", replacement: path.resolve(__dirname, "packages/tool-kit/src/index.ts") },
      // webext-registry 静态载入 examples 的 .pi/web:stickers.tsx 直连 canvas-kit(非根声明依赖,
      // Next 走 tsconfig paths 可解析,vitest 不读 paths 须显式 alias);canvas-ui 同规则对齐。
      { find: "@blksails/pi-web-canvas-kit", replacement: path.resolve(__dirname, "packages/canvas-kit/src/index.ts") },
      { find: "@blksails/pi-web-canvas-ui", replacement: path.resolve(__dirname, "packages/canvas-ui/src/index.ts") },
      // registry 客户端已发 npm(@blksails/registry-client),经 package.json 的别名依赖
      // `"@pi-clouds/registry-client": "npm:@blksails/registry-client@^0.0.1"` 正常解析,
      // 不再需要越仓 alias —— 那正是 desktop-release 在 CI 上永远构建不出来的原因。
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["test/setup.ts"],
  },
});
