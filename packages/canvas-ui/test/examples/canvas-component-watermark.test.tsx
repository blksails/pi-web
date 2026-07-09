/**
 * 范例组件包测试挂载(spec cli-component-add,任务 5.2,Req 8.4)。
 *
 * `examples/canvas-component-watermark` 是 kind:"component" 组件包,其测试
 * **随源分发**(watermark.test.tsx 在 component.files 内,拷入使用者 source 后
 * 在其测试设施下运行)。本 wrapper 把同一份测试文件经相对路径 import 注册进
 * 本仓套件 —— 挂在 canvas-ui:此处具备该测试所需的全部解析条件
 * (@blksails/pi-web-canvas-kit alias → src、jsdom、tsx)。断言集见组件包内文件:
 * 图层渲染/拍平降级/Inspector 回写/工具置层声明/动作能力避让矩阵。
 */
import "../../../../examples/canvas-component-watermark/components/watermark/watermark.test";
