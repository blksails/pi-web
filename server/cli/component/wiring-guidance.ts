/**
 * wiring-guidance — 接线指引生成(spec cli-component-add,任务 2.5,Req 5.4, 6.2;
 * v1.1 增 slots 点 · scene3d 设计稿 §7 M0)。
 *
 * v1 不做 codemod(设计稿 §4.4:改写使用者的 web.config.tsx 有毁源风险,先打印指引,
 * codemod 归 v2)。指引完全由清单 `component.wiring` 声明驱动 —— import 绑定名、
 * 相对路径、插件点键名、具名槽 key 都不猜。e2e 的「代行手工接线」(Req 9.1)按同一份
 * 指引机械执行,故本函数同时导出结构化形态(`WiringGuidance`)与终端文本形态。
 *
 * 两种插件点的挂载形态:
 *   - `canvasPlugins`(数组追加):   `canvasPlugins: [watermarkBundle],`
 *   - `slots`(具名槽对象键,JSX):  `slots: { panelRight: <Scene3dPanel /> },`
 */
import type { ComponentWiring } from "@blksails/pi-web-protocol";

export interface WiringGuidance {
  /** 打进 web.config.tsx 顶部的 import 行。 */
  readonly importLine: string;
  /** defineWebExtension 配置对象里的目标键。 */
  readonly point: ComponentWiring["point"];
  /** 具名槽 key(仅 point:"slots")。 */
  readonly slot?: string;
  /** 挂载表达式:canvasPlugins=导出绑定名;slots=JSX 元素。 */
  readonly entry: string;
  /** 完整的配置行(挂进 defineWebExtension 对象)。 */
  readonly configLine: string;
}

export function buildWiringGuidance(wiring: ComponentWiring): WiringGuidance {
  const importLine = `import { ${wiring.export} } from "${wiring.from}";`;
  if (wiring.point === "slots") {
    const slot = wiring.slot ?? "panelRight";
    const entry = `<${wiring.export} />`;
    return {
      importLine,
      point: wiring.point,
      slot,
      entry,
      configLine: `slots: { ${slot}: ${entry} },`,
    };
  }
  return {
    importLine,
    point: wiring.point,
    entry: wiring.export,
    configLine: `${wiring.point}: [${wiring.export}],`,
  };
}

/** 终端呈现(安装成功 / dry-run 共用;Req 5.4, 6.2)。 */
export function renderWiringGuidance(guidance: WiringGuidance): string {
  const merge =
    guidance.point === "slots"
      ? `  // defineWebExtension({ ... }) 内(slots 已有其它键时并入同一对象):`
      : `  // defineWebExtension({ ... }) 内:`;
  return [
    `接线(手动,v1 不改写你的文件):在目标 source 的 .pi/web/web.config.tsx 中`,
    `  ${guidance.importLine}`,
    merge,
    `  ${guidance.configLine}`,
    `完成接线后运行 \`pi-web build\` 编译生效。`,
  ].join("\n");
}
