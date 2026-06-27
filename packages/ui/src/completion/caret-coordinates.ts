/**
 * textarea caret 像素坐标(镜像 div 技术,无第三方依赖)。
 *
 * 参考 textarea-caret-coordinates 思路自实现:把 textarea 的关键计算样式复制到一个
 * 屏外镜像 <div>,将 `value` 截至 `offset` 的文本写入镜像并追加一个标记 <span>,读取该
 * span 相对镜像的 offsetTop/offsetLeft 与行高,即得 caret 在 textarea **内容坐标系**
 * (未计入 textarea 自身滚动)的位置。用后立即移除镜像,无 DOM 残留。
 *
 * 仅在浏览器读写 DOM;无 document 时安全返回零坐标(SSR 友好,不抛)。
 */

export interface CaretCoordinates {
  /** caret 顶相对 textarea 内容原点的像素。 */
  readonly top: number;
  /** caret 左相对 textarea 内容原点的像素。 */
  readonly left: number;
  /** 行高(像素),用于把浮层落在 caret 下方。 */
  readonly height: number;
}

const ZERO: CaretCoordinates = { top: 0, left: 0, height: 0 };

/** 需从 textarea 复制到镜像、以保证换行/度量一致的计算样式属性。 */
const COPIED_PROPERTIES: readonly string[] = [
  "boxSizing",
  "width",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "whiteSpace",
  "wordWrap",
  "wordBreak",
];

/**
 * 计算 textarea 中字符 `offset` 处的 caret 像素坐标(相对 textarea 内容原点)。
 * 无 DOM/无 el 时返回零坐标。
 */
export function getCaretCoordinates(
  el: HTMLTextAreaElement | null | undefined,
  offset: number,
): CaretCoordinates {
  if (
    el === null ||
    el === undefined ||
    typeof document === "undefined" ||
    typeof window === "undefined"
  ) {
    return ZERO;
  }

  const mirror = document.createElement("div");
  const style = mirror.style;
  const computed = window.getComputedStyle(el);

  // 屏外、隐藏、按内容换行的镜像。
  style.position = "absolute";
  style.visibility = "hidden";
  style.top = "0";
  style.left = "-9999px";
  style.whiteSpace = "pre-wrap";
  style.setProperty("word-wrap", "break-word");
  style.overflow = "hidden";

  const styleBag = style as unknown as Record<string, string>;
  const computedBag = computed as unknown as Record<string, string>;
  for (const prop of COPIED_PROPERTIES) {
    // 以驼峰键在 CSSStyleDeclaration 上读写(避开只读索引签名)。
    styleBag[prop] = computedBag[prop] ?? "";
  }
  // textarea 内容区按其自身宽度换行;确保镜像宽度与之一致。
  style.width = computed.width;

  // 截至 offset 的文本(换行/空格 pre-wrap 保留);用标记 span 定位 caret。
  mirror.textContent = el.value.slice(0, Math.max(0, offset));
  const marker = document.createElement("span");
  // span 内放一个字符以获得稳定的 offsetHeight(行高);用接下来的字符或占位点。
  marker.textContent = el.value.slice(offset) || ".";
  mirror.appendChild(marker);

  document.body.appendChild(mirror);
  let result: CaretCoordinates;
  try {
    const lineHeight =
      parseFloat(computed.lineHeight) ||
      parseFloat(computed.fontSize) * 1.2 ||
      marker.offsetHeight ||
      0;
    result = {
      top: marker.offsetTop,
      left: marker.offsetLeft,
      height: lineHeight,
    };
  } catch {
    result = ZERO;
  } finally {
    document.body.removeChild(mirror);
  }
  return result;
}
