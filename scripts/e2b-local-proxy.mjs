#!/usr/bin/env node
/**
 * e2b 本地反代 —— 把 e2b SDK(经 E2B_API_URL 指到本地)转到 agent-sandbox manager 的
 * `/e2b/v1` 控制面。仅本地开发用(`dev:e2b:local`)。
 *
 * 三个坑(见 pi-clouds real-machine-verification-checklist §8.2):
 *  - manager 按 **Host 头** 做 domain 路由(默认 localhost)→ 转发时强制 `Host: localhost`,
 *    否则请求被当沙箱代理而 404(`invalid sandbox request`)。
 *  - 上游连 **127.0.0.1**(macOS `localhost` 先解析 IPv6,port-forward 只听 IPv4)。
 *  - 路径前缀 `/e2b/v1`。
 *
 * env:
 *  - PROXY_PORT          本地监听端口(默认 13000)
 *  - UPSTREAM_HOST_IP    上游 IP(默认 127.0.0.1)
 *  - UPSTREAM_PORT       上游端口(默认 10000,即 port-forward 的 manager)
 *  - UPSTREAM_PREFIX     上游路径前缀(默认 /e2b/v1)
 */
import http from "node:http";

const PROXY_PORT = Number(process.env.PROXY_PORT ?? 13000);
const UP_HOST = process.env.UPSTREAM_HOST_IP ?? "127.0.0.1";
const UP_PORT = Number(process.env.UPSTREAM_PORT ?? 10000);
const PREFIX = process.env.UPSTREAM_PREFIX ?? "/e2b/v1";

const server = http.createServer((req, res) => {
  const up = http.request(
    {
      host: UP_HOST,
      port: UP_PORT,
      method: req.method,
      path: PREFIX + req.url,
      headers: { ...req.headers, host: "localhost" },
    },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res);
    },
  );
  up.on("error", (e) => {
    if (!res.headersSent) res.writeHead(502);
    res.end(`proxy upstream error: ${String(e)}`);
  });
  req.pipe(up);
});

server.listen(PROXY_PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(
    `[e2b-local-proxy] :${PROXY_PORT} -> ${UP_HOST}:${UP_PORT}${PREFIX} (Host: localhost)`,
  );
});
