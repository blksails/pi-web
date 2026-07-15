/**
 * 最小夹具 agent 入口(spec sandbox-baked-agent-image,任务 3.3;Req 7.1)。
 * 刻意自包含(不 import pi SDK):根 typecheck 的 include 覆盖 test/**,
 * 夹具只为烘焙计划集成测试提供真实盘面结构,不需要可运行的 agent 语义。
 * routes/hello.ts 的 import 使其成为「bundle 模式被 esbuild 内联、不进 staging
 * files 清单」的被测源文件。
 */
import { hello } from "./routes/hello";

export default {
  name: "baked-agent-fixture",
  greet(): string {
    return hello();
  },
};
