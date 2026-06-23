/**
 * 输入图像规范化 — 剥除 Apple「多图 JPEG」容器(纯 JS,零依赖,前后端皆安全)。
 *
 * 背景:NewAPI gpt-image 网关(apiservices.top)对 **iPhone 多图 JPEG** 的上游渠道选择会失败,
 * 返回误导性的「可用渠道不存在 / This token has no access to model(model 名为空)」。这类文件含:
 *  - `APP2` 段里的 **MPF(Multi-Picture Format)** 索引,以及
 *  - 主图 `EOI` 之后追加的**第二张 JPEG**(HDR gain map)。
 *
 * 实测(对真实失败图逐段剥离 + 打网关)结论:
 *  - 只剥 EXIF(APP1)→ 仍失败;
 *  - 剥 MPF(APP2)+ 在主图首个 EOI 处截断(去掉尾部 gain map)→ **通过**,且保留 EXIF 方向。
 *
 * 故本模块**只剥 MPF 类 APP2 段并截断尾部多余数据**:无损(不重编码、不缩放)、保留 EXIF/ICC 等
 * 其它元数据、保留拍摄方向。仅作用于 JPEG;其它格式(PNG mask 等)与无 MPF 的普通 JPEG 原样返回。
 */

// APP2 载荷以此 4 字节("MPF" + NUL)开头者为 CIPA/Apple 多图(MPF)索引;
// 区别于以 "ICC_PROFILE" 开头的色彩配置 APP2(后者必须保留)。
const MPF_MAGIC = [0x4d, 0x50, 0x46, 0x00];

function parseDataUri(uri: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(uri);
  if (!m) return null;
  const mime = m[1] ?? "image/png";
  const bytes = m[2]
    ? new Uint8Array(Buffer.from(m[3] ?? "", "base64"))
    : new Uint8Array(Buffer.from(decodeURIComponent(m[3] ?? ""), "utf8"));
  return { mime, bytes };
}

/** APP2 载荷(FFE2+2 字节长度之后)是否以 MPF 标识开头。 */
function isMpfSegment(buf: Uint8Array, payloadStart: number): boolean {
  for (let k = 0; k < MPF_MAGIC.length; k++) {
    if (buf[payloadStart + k] !== MPF_MAGIC[k]) return false;
  }
  return true;
}

/**
 * 剥除 JPEG 字节中的 MPF(APP2)段,并在主图首个 EOI 处截断(去掉追加的 gain map)。
 * 非 JPEG / 解析异常 / 无可剥内容时返回 null(调用方据此原样保留)。
 */
function stripMpf(buf: Uint8Array): Uint8Array | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null; // 非 JPEG(无 SOI)

  const out: number[] = [0xff, 0xd8];
  let i = 2;
  let changed = false;

  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      // 非标记字节(理论上不应出现在段边界);保守拷贝以免破坏数据。
      out.push(buf[i]!);
      i++;
      continue;
    }
    const marker = buf[i + 1]!;

    // 填充 0xFF:跳过单个 FF
    if (marker === 0xff) {
      out.push(0xff);
      i++;
      continue;
    }
    // EOI:写入后截断(丢弃其后追加的第二张图)
    if (marker === 0xd9) {
      out.push(0xff, 0xd9);
      if (i + 2 < buf.length) changed = true; // 尾部有多余数据被截断
      i += 2;
      break;
    }
    // SOS:其后为熵编码数据,扫描至首个 EOI 一并拷贝,然后截断
    if (marker === 0xda) {
      let j = i;
      while (j < buf.length - 1 && !(buf[j] === 0xff && buf[j + 1] === 0xd9)) j++;
      const end = j + 2 <= buf.length ? j + 2 : buf.length;
      for (let k = i; k < end; k++) out.push(buf[k]!);
      if (end < buf.length) changed = true;
      i = end;
      break;
    }
    // 无长度的独立标记(RSTn / TEM):原样拷贝
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }
    // 带长度的段:FFxx + 2 字节长度 + 载荷
    const len = (buf[i + 2]! << 8) | buf[i + 3]!;
    const segEnd = i + 2 + len;
    if (marker === 0xe2 && isMpfSegment(buf, i + 4)) {
      // 丢弃 MPF(APP2)段
      changed = true;
      i = segEnd;
      continue;
    }
    for (let k = i; k < segEnd && k < buf.length; k++) out.push(buf[k]!);
    i = segEnd;
  }

  return changed ? Uint8Array.from(out) : null;
}

/**
 * 规范化一个 data URI 图像:剥除 Apple 多图 JPEG 容器(MPF + 尾部 gain map)。
 *
 * 仅处理 `data:image/jpeg`;非 data: / 非 JPEG / 无 MPF / 解析失败时**原样返回**输入,
 * 绝不阻断工具调用。
 */
export function normalizeImageDataUri(input: string): string {
  if (
    !input.startsWith("data:image/jpeg") &&
    !input.startsWith("data:image/jpg")
  ) {
    return input;
  }
  const parsed = parseDataUri(input);
  if (!parsed) return input;
  try {
    const stripped = stripMpf(parsed.bytes);
    if (!stripped) return input;
    const b64 = Buffer.from(stripped).toString("base64");
    return `data:image/jpeg;base64,${b64}`;
  } catch {
    return input;
  }
}
