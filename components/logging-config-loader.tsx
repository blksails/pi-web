"use client";
/**
 * LoggingConfigLoader — client 端日志配置加载器。
 *
 * 在 mount 时从 /api/config/logging 拉取配置，调用 configureLogger 使浏览器侧
 * 日志库按用户配置门控（Req 6.4 全局开关、6.5 命名空间、6.6 级别）。
 * 渲染透明（不产出 DOM），失败静默处理（不影响正常聊天流程）。
 *
 * Requirements: 6.4, 6.5, 6.6
 */
import * as React from "react";
import { configureLogger, type LogLevel } from "@blksails/pi-web-logger";

interface LoggingConfig {
  enabled?: boolean;
  level?: string;
  namespaces?: Record<string, boolean>;
}

/** 窄化 string → LogLevel（仅允许合法值，其余忽略）。 */
const LOG_LEVELS: ReadonlySet<string> = new Set(["debug", "info", "warn", "error"]);
function isLogLevel(v: string): v is LogLevel {
  return LOG_LEVELS.has(v);
}

export function LoggingConfigLoader(): null {
  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/config/logging", { method: "GET" });
        // 日志默认**关闭**：端点不可达时浏览器侧也保持关闭（不沿用库默认），
        // 仅当用户在 Settings 显式保存 enabled=true 时才开启。
        if (!res.ok) {
          configureLogger({ enabled: false });
          return;
        }
        const json = (await res.json()) as { values?: LoggingConfig };
        const cfg = json.values ?? {};
        const partial: Parameters<typeof configureLogger>[0] = {};
        // 配置缺失（values 为空 / 无 enabled 字段）→ 视为关闭，与 schema 默认值一致。
        partial.enabled = cfg.enabled === true;
        if (typeof cfg.level === "string" && isLogLevel(cfg.level)) partial.level = cfg.level;
        if (typeof cfg.namespaces === "object" && cfg.namespaces !== null) {
          partial.namespaces = cfg.namespaces;
        }
        configureLogger(partial);
      } catch {
        // 静默失败：保持默认关闭，不影响主流程
        configureLogger({ enabled: false });
      }
    })();
  }, []);

  return null;
}
