import type { AgentRouteDecl } from "@blksails/pi-web-agent-kit";
import { assetsListRoute } from "./assets-list.js";
import { materialStatusRoute } from "./material-status.js";
import { materialsLibraryRoute } from "./materials-library.js";

export {
  assetsListHandler,
  assetsListRoute,
  createAssetsListHandler,
  type AssetsListDependencies,
} from "./assets-list.js";
export {
  isTrustedMaterialsApiUrl,
  materialsApiUrl,
  materialsLibraryHandler,
  materialsLibraryRoute,
  projectMaterial,
} from "./materials-library.js";
export {
  createMaterialStatusHandler,
  materialStatusHandler,
  materialStatusRoute,
  parseStatusIds,
} from "./material-status.js";

export const materialsRoutes: readonly AgentRouteDecl[] = [
  assetsListRoute,
  materialsLibraryRoute,
  materialStatusRoute,
];
