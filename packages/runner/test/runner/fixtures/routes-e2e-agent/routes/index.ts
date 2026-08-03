/** routes-e2e-agent 的全部 route(barrel)。四个 route 覆盖集成断言面。 */
import { galleryStatsRoute } from "./gallery-stats.js";
import { echoRoute } from "./echo.js";
import { boomRoute } from "./boom.js";
import { slowRoute } from "./slow.js";

export const routes = [galleryStatsRoute, echoRoute, boomRoute, slowRoute];
