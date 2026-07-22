# 发版清单

> 本清单只收录**机制无法自动保证、必须由人判断**的条目。
> 凡是能靠构建/测试兜住的，一律做成机制而不是写进清单 —— 清单靠纪律，纪律会失效。

---

## webext 版本兼容门控已移除

webext 加载不再对 `manifest.targetApiVersion` 与宿主 web-kit 版本做兼容判定 —— `isApiCompatible`、`hostApiVersion` 字段、`__PI_WEB_KIT_VERSION__` 构建期注入（原 `scripts/web-kit-version.mjs` 及四条构建路径的 `define`）、`lib/app/host-api-version.ts` 及其护栏测试**已整条删除**。

理由：宿主自述版本长期失真（曾用 `env ?? "0.1.0"` 兜底而包实际已到 0.5.x），minor 从未真正充当过保护边界；web-kit 版本随 monorepo 统一 bump，minor 跳动不表达 API 破坏。既然这道门控拦不住真正的破坏、只会误拒存量扩展，遂整条撤除。

现在扩展加载只剩两道安全校验：**SRI 完整性** 与 **Ed25519 签名白名单**（均与版本无关）。`manifest.targetApiVersion` 字段仍保留于协议中，但加载时不再读取。

> web-kit 发生破坏性 API 变更时，宿主与扩展的兼容性不再由加载期门控兜底，须靠发布协调与运行时行为自行保证。
