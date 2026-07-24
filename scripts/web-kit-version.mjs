import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_KIT_PACKAGE_JSON = join(ROOT, "packages", "web-kit", "package.json");

export function resolveWebKitVersion(env = process.env) {
  const override = env.NEXT_PUBLIC_PI_WEB_KIT_VERSION ?? env.PI_WEB_KIT_VERSION;
  if (override !== undefined && override.trim() !== "") return override.trim();

  const pkg = JSON.parse(readFileSync(WEB_KIT_PACKAGE_JSON, "utf8"));
  if (typeof pkg.version !== "string" || pkg.version.trim() === "") {
    throw new Error("[web-kit-version] packages/web-kit/package.json missing version");
  }
  return pkg.version;
}

export function webKitVersionDefine(env = process.env) {
  return {
    __PI_WEB_KIT_VERSION__: JSON.stringify(resolveWebKitVersion(env)),
  };
}
