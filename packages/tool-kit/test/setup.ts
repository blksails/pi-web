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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureLogger } from "@blksails/pi-web-logger";

configureLogger({ enabled: false });

// 装配期配置隔离:resolveAgentDir() 缺 env 覆盖时读真机 `~/.pi/agent`,本机的
// aigc.json(disabledModels 等)会渗入装配期单测,造成「模型目录漂移」假红
// (F2 残噪终判,2026-07-24)。统一指向每次全新的临时目录,任何本机配置不可见。
const isolatedAgentDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "pi-web-toolkit-test-"),
);
process.env.PI_WEB_AGENT_DIR = isolatedAgentDir;
delete process.env.PI_CODING_AGENT_DIR;
