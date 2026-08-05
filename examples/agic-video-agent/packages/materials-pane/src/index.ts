import { materialsPaneModule } from "./module.js";
import { materialsRoutes } from "./routes/index.js";
import { materialsSurfaceExtension } from "./surface.js";
import { materialsToolsExtension } from "./ai/tools.js";

export * from "./application/index.js";
export * from "./ai/index.js";
export {
  CANVAS_OPEN_ATTACHMENTS_EVENT,
  MATERIALS_OPEN_EVENT,
  parseMaterialsOpenEvent,
  type MaterialsOpenEvent,
} from "./events.js";
export { materialsPaneModule, type MaterialsPaneModule } from "./module.js";
export {
  getMaterialsPlatformClient,
  type MaterialKind,
  type MaterialsAssetQuery,
  type MaterialsPlatformClient,
} from "./platform.js";
export * from "./routes/index.js";
export {
  emptyMaterialsState,
  makeMaterialsSurfaceExtension,
  materialsSurfaceExtension,
  MATERIALS_DOMAIN,
  type MaterialsFilter,
  type MaterialsFolder,
  type MaterialsState,
} from "./surface.js";
export {
  installMaterialsPaneStyles,
  MATERIALS_PANE_CSS,
} from "./styles.js";

/** 任意 Agent 可直接分拆并入其三张标准清单，无 AIGC 私有依赖。 */
export const materialsPanePackage = {
  pane: materialsPaneModule,
  routes: materialsRoutes,
  extensions: [materialsSurfaceExtension, materialsToolsExtension],
} as const;
