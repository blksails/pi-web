import { searchPaneModule } from "./module.js";
import { searchRoutes } from "./routes/index.js";
import { searchToolsExtension } from "./ai/tools.js";

export * from "./ai/index.js";
export { searchPaneModule, type SearchPaneModule } from "./module.js";
export {
  getSearchPlatformClient,
  SearchPlatformError,
  type CreativeSearchResult,
  type SearchPlatformClient,
} from "./platform.js";
export * from "./routes/index.js";
export {
  installSearchPaneStyles,
  SEARCH_PANE_CSS,
} from "./styles.js";

/** 任意 Agent 可直接把 Pane 与 routes 并入两张标准清单。 */
export const searchPanePackage = {
  pane: searchPaneModule,
  routes: searchRoutes,
  extensions: [searchToolsExtension],
} as const;
