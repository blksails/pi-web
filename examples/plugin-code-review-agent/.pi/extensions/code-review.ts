// 自运行(origin:top-level)时 SDK 扫 .pi/extensions;转发到包根真身,避免维护两份。
export { default } from "../../extensions/code-review.ts";
