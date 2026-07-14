/**
 * attachment · S3AttachmentRegistry 真实服务集成测试(attachment-backend-pluggable spec,
 * 任务 4.4;Req 5.2/5.3)。
 *
 * env 门控:与 {@link ./s3-blob-backend.integration.test.js} 同一组变量,未配置真实 S3 兼容服务时
 * 整体 skip。覆盖:双实例描述符互读(Req 5.3)。
 */
import { describe, expect, it } from "vitest";
import type { Attachment } from "@blksails/pi-web-protocol";
import { S3AttachmentRegistry } from "../../../src/attachment/s3/s3-registry.js";

const ENDPOINT = process.env["PI_WEB_TEST_S3_ENDPOINT"];
const BUCKET = process.env["PI_WEB_TEST_S3_BUCKET"];
const ACCESS_KEY = process.env["PI_WEB_TEST_S3_ACCESS_KEY"];
const SECRET_KEY = process.env["PI_WEB_TEST_S3_SECRET_KEY"];
const REGION = process.env["PI_WEB_TEST_S3_REGION"] ?? "us-east-1";
const FORCE_PATH_STYLE = process.env["PI_WEB_TEST_S3_FORCE_PATH_STYLE"] === "1";

const configured =
  ENDPOINT !== undefined && BUCKET !== undefined && ACCESS_KEY !== undefined && SECRET_KEY !== undefined;

function makeRegistry(prefix: string): S3AttachmentRegistry {
  return new S3AttachmentRegistry({
    endpoint: ENDPOINT!,
    bucket: BUCKET!,
    region: REGION,
    accessKeyId: ACCESS_KEY!,
    secretAccessKey: SECRET_KEY!,
    forcePathStyle: FORCE_PATH_STYLE,
    prefix,
  });
}

describe.skipIf(!configured)("S3AttachmentRegistry 真实服务集成(env 门控,Req 5.2/5.3)", () => {
  it("双实例描述符互读:一实例 save,另一实例 get/listBySession 均可读回", async () => {
    const prefix = `it-${Date.now()}-reg/`;
    const writer = makeRegistry(prefix);
    const reader = makeRegistry(prefix);
    const att: Attachment = {
      id: "att_reg_shared",
      name: "shared.png",
      mimeType: "image/png",
      size: 10,
      origin: "upload",
      sessionId: "sess-shared",
      createdAt: new Date().toISOString(),
    };

    await writer.save(att);

    const got = await reader.get(att.id);
    expect(got).toEqual(att);

    const list = await reader.listBySession("sess-shared");
    expect(list.map((a) => a.id)).toContain(att.id);
  });
});
