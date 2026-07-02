/**
 * surface-demo-agent — agent 权威 surface(agent-authoritative-surface)的**领域无关**最小示例。
 *
 * 演示把「富交互 UI = agent 进程里某 `domain` 的瘦投影 + 命令发起端」CQRS 范式落成一个 config:
 *  - agent 侧经 `extensions: [(pi) => createSurface(pi, { domain:"demo", … })]` 装载一个 surface,
 *    持权威快照 `{ count, log }`、暴露 `increment` / `echo` 两个命令、注册探针命令 `surface:demo`;
 *  - `.pi/web` 用 `SlotContribution` 具名槽挂 `SurfaceDemoPanel`,内部 `useSurface("demo")` 镜像
 *    count/log、点击触发 `run("increment")`(命令走 ui-rpc agent 转发,不过 LLM),并在
 *    `available===false`(非该 domain 的 source)时退化为只读。
 *
 * **零 AIGC / 领域语义泄漏进宿主**:count/log 纯计数/日志,仅示例夹具与 UI 渲染器知晓 domain 名。
 *
 * surface 门面经 `@blksails/pi-web-tool-kit/runtime` 子入口引入(含 pi SDK 值导入,仅 jiti 子进程
 * 加载,不进 Next 服务端 bundle)。model 省略 → 继承 ~/.pi/agent/settings.json 默认 provider/model。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSurface, type SurfaceCtx } from "@blksails/pi-web-tool-kit/runtime";

/** 领域无关快照:一个计数器 + 一份 echo 日志。 */
interface DemoState {
  count: number;
  log: string[];
}

export default defineAgent({
  systemPrompt: [
    "You are surface-demo-agent, a pi-web example demonstrating the agent-authoritative-surface SDK.",
    "A 'demo' surface holds an authoritative { count, log } snapshot in this process.",
    "The user interacts with the surface panel directly (commands bypass the LLM); keep chat replies concise.",
  ].join("\n"),
  // surface 经进程内 ExtensionFactory 装载(对齐 aigcExtension)。initialState 在此处构造 → 不共享引用。
  extensions: [
    (pi: ExtensionAPI): void => {
      createSurface<DemoState>(pi, {
        domain: "demo",
        initialState: { count: 0, log: [] },
        commands: {
          /** 计数 +1;返回新计数(命令返回「发生了什么」,快照才是「现在是什么」)。 */
          increment: (_args, ctx: SurfaceCtx<DemoState>) => {
            ctx.setState((s) => ({ ...s, count: s.count + 1 }));
            return { count: ctx.get().count };
          },
          /** 把 args.text 追加进日志。 */
          echo: (args, ctx: SurfaceCtx<DemoState>) => {
            const text = String((args as { text?: unknown } | undefined)?.text ?? "");
            ctx.setState((s) => ({ ...s, log: [...s.log, text] }));
            return { echoed: text, size: ctx.get().log.length };
          },
        },
      });
    },
  ],
  // Self-contained:关掉内置工具与磁盘发现的 skills,保持示例 hermetic。
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
