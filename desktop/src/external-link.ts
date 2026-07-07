/**
 * 外链打开决策(spec pi-web-desktop task 2.2,Req 5.4)。
 *
 * 纯函数,不依赖 electron:窗口的 setWindowOpenHandler 据此决定把外部链接交系统默认
 * 浏览器(open-external)还是仅拒绝(deny)。**先校验 scheme 与 host**——只有非回环的
 * http/https 才外开;其余(非 http(s) scheme、回环本地 UI、非法 url)一律 deny,防止把
 * 不受信输入交给 shell.openExternal(可致命令执行)、以及为本地 UI 自身另开系统浏览器。
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export type ExternalOpenDecision = "open-external" | "deny";

export function decideExternalOpen(rawUrl: string): ExternalOpenDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "deny";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "deny";
  // URL 对 [::1] 归一化后 hostname 为 "[::1]";统一剥括号再比对。
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTS.has(host)) return "deny";
  return "open-external";
}
