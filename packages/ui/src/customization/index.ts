/**
 * @pi-web/ui 定制域出口。
 *
 * 注意:elements 层只 import 具体文件(如 `./icons.js`)以避免与本聚合出口形成循环;
 * 本 index 供装配层(PiChat)与包公开导出使用。
 */
export {
  IconsProvider,
  useIcon,
  type IconProps,
  type IconComponent,
  type IconSlot,
  type IconTheme,
  type IconsProviderProps,
} from "./icons.js";
export {
  layoutClassNames,
  type LayoutPreset,
  type LayoutClassNames,
} from "./layout.js";
export {
  resolveComponent,
  type ComponentOverrides,
  type MessageRole,
} from "./component-overrides.js";
