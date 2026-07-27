/**
 * cloud 配置域(spec desktop-cloud-login 任务 8.1,Req 8.1/8.6)。
 *
 * 该域存在的理由:云端登录此前只能由环境变量启用,而打包的桌面版拿不到环境变量
 * (壳不转发、Finder 无 shell env、.env 落在会被 GC 的运行时目录)——
 * 实测表现为双击打开后 `GET /api/auth/me` 404、登录入口不渲染。
 */
import { describe, it, expect } from "vitest";
import {
  cloudConfigSchema,
  cloudFormSchema,
  cloudEgressBaseOf,
} from "../../src/config/domains/cloud.js";

describe("cloudConfigSchema", () => {
  it("接受合法 http/https 地址", () => {
    for (const v of [
      "https://cloud.example/api/desktop/egress/v1",
      "http://127.0.0.1:8080/api/desktop/egress",
    ]) {
      expect(cloudConfigSchema.safeParse({ egressBase: v }).success).toBe(true);
    }
  });

  it("缺失字段 → 视为未配置(不报错)", () => {
    const r = cloudConfigSchema.safeParse({});
    expect(r.success).toBe(true);
    expect(cloudEgressBaseOf(r.success ? r.data : undefined)).toBeUndefined();
  });

  it("空串与纯空白 → 视为未配置(等价于关闭云端登录)", () => {
    for (const v of ["", "   "]) {
      const r = cloudConfigSchema.safeParse({ egressBase: v });
      expect(r.success).toBe(true);
      expect(cloudEgressBaseOf(r.success ? r.data : undefined)).toBeUndefined();
    }
  });

  describe("拒绝非法值(Req 8.6:保存时拒绝,不写入非法值)", () => {
    it("非 URL 文本", () => {
      expect(cloudConfigSchema.safeParse({ egressBase: "not a url" }).success).toBe(false);
    });

    it("非 http/https 协议", () => {
      for (const v of ["ftp://host/x", "file:///tmp/x", "javascript:alert(1)"]) {
        expect(cloudConfigSchema.safeParse({ egressBase: v }).success).toBe(false);
      }
    });

    it("只有主机名、缺协议", () => {
      expect(cloudConfigSchema.safeParse({ egressBase: "cloud.example/api" }).success).toBe(false);
    });
  });

  it("拒绝时给出可操作的说明(而非泛化 invalid)", () => {
    const r = cloudConfigSchema.safeParse({ egressBase: "nope" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/http/);
    }
  });
});

describe("cloudFormSchema", () => {
  it("domain 为 cloud,含 egressBase 字段", () => {
    expect(cloudFormSchema.domain).toBe("cloud");
    const names = JSON.stringify(cloudFormSchema);
    expect(names).toContain("egressBase");
  });

  it("★ 字段说明必须含「重启」提示(Req 8.7)", () => {
    // 配置在装配期读一次(handler 单例 pin 在 globalThis),改完不重启不生效。
    // 缺这句提示,用户会以为功能坏了 —— 故此断言刻意锁住文案要点。
    expect(JSON.stringify(cloudFormSchema)).toMatch(/重启/);
  });
});

describe("cloudEgressBaseOf", () => {
  it("有值时原样返回(已 trim)", () => {
    expect(cloudEgressBaseOf({ egressBase: " https://c.example/x " })).toBe(
      "https://c.example/x",
    );
  });

  it("undefined 配置 → undefined", () => {
    expect(cloudEgressBaseOf(undefined)).toBeUndefined();
  });
});
