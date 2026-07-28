/**
 * Vitest setup — silence the logger for tool-kit tests.
 *
 * The logger's library default is `enabled: true, level: "debug"` (see
 * @blksails/pi-web-logger config), and the Node default sink writes
 * sentinel-framed lines to stderr. In production the runner gates this via
 * `initConfigFromEnv()` (server-authoritative, off by default), but tests never
 * call it — so without this, every execute/persist path would spam test stderr.
 * We're not asserting log output here, so turn logging off globally.
 */
import { configureLogger } from "@blksails/pi-web-logger";

configureLogger({ enabled: false });
