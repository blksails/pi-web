/**
 * wiring-guidance — 接线指引生成(spec cli-component-add,任务 2.5,Req 5.4, 6.2)。
 *
 * v1 不做 codemod(设计稿 §4.4:改写使用者的 web.config.tsx 有毁源风险,先打印指引,
 * codemod 归 v2)。指引完全由清单 `component.wiring` 声明驱动 —— import 绑定名、
 * 相对路径、插件点键名都不猜。e2e 的「代行手工接线」(Req 9.1)按同一份指引机械执行,
 * 故本函数同时导出结构化形态(`WiringGuidance`)与终端文本形态。
 */
import type { ComponentWiring } from "@blksails/pi-web-protocol";

export interface WiringGuidance {
  /** 打进 web.config.tsx 顶部的 import 行。 */
  readonly importLine: string;
  /** defineWebExtension 配置对象里的目标键。 */
  readonly point: ComponentWiring["point"];
  /** 追加进该键数组的表达式(即导出绑定名)。 */
  readonly arrayEntry: string;
}

export function buildWiringGuidance(wiring: ComponentWiring): WiringGuidance {
  return {
    importLine: `import { ${wiring.export} } from "${wiring.from}";`,
    point: wiring.point,
    arrayEntry: wiring.export,
  };
}

/** 终端呈现(安装成功 / dry-run 共用;Req 5.4, 6.2)。 */
export function renderWiringGuidance(guidance: WiringGuidance): string {
  return [
    `接线(手动,v1 不改写你的文件):在目标 source 的 .pi/web/web.config.tsx 中`,
    `  ${guidance.importLine}`,
    `  // defineWebExtension({ ... }) 内:`,
    `  ${guidance.point}: [${guidance.arrayEntry}],`,
    `完成接线后运行 \`pi-web build\` 编译生效。`,
  ].join("\n");
}
