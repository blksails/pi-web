/**
 * pi-web build — CSS scoping(任务 2.3 / Req 8)。
 *
 * scoping 只防撞不围栏,由本工具**强制**:
 *  - 所有 class 选择器前缀 `pw-<extId>-`(配合 web-kit 的 `cx(extId, name)` 保证 TSX 一致)
 *  - 拒绝全局选择器(`*` / `html` / `body` / `:root` / 顶层标签 / `@layer base`)
 *  - `@keyframes` / `@font-face` 名命名空间化
 *  - 拒绝 Tailwind preflight(其 universal reset 会打到 `*`)
 *  - 自定义 CSS 变量须 `--pw-<extId>-*`(只读宿主 token,不可覆写)
 *
 * 注:这是面向受控输入的聚焦转换器(brace 感知遍历),非通用 CSS AST。违规以
 * `ScopeCssError` 列出,调用方(build)据此 fail 出包。
 */

export interface ScopeCssResult {
  readonly css: string;
  readonly errors: readonly string[];
}

const GLOBAL_SELECTOR_TOKENS = new Set([
  "*",
  "html",
  "body",
  ":root",
  "::before",
  "::after",
]);

const HTML_TAGS = new Set([
  "a","abbr","address","area","article","aside","audio","b","base","bdi","bdo",
  "blockquote","button","canvas","caption","cite","code","col","colgroup","data",
  "datalist","dd","del","details","dfn","dialog","div","dl","dt","em","embed",
  "fieldset","figcaption","figure","footer","form","h1","h2","h3","h4","h5","h6",
  "header","hgroup","hr","i","iframe","img","input","ins","kbd","label","legend",
  "li","main","map","mark","menu","meter","nav","object","ol","optgroup","option",
  "output","p","picture","pre","progress","q","rp","rt","ruby","s","samp","section",
  "select","small","source","span","strong","sub","summary","sup","table","tbody",
  "td","template","textarea","tfoot","th","thead","time","tr","track","u","ul",
  "var","video","wbr",
]);

/** 切顶层规则:返回 {prelude, body, isAtRule}[]。brace 感知。 */
function splitRules(css: string): { prelude: string; body: string }[] {
  const out: { prelude: string; body: string }[] = [];
  let depth = 0;
  let preludeStart = 0;
  let i = 0;
  let bodyStart = -1;
  for (; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      if (depth === 0) bodyStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && bodyStart >= 0) {
        out.push({
          prelude: css.slice(preludeStart, bodyStart).trim(),
          body: css.slice(bodyStart + 1, i),
        });
        preludeStart = i + 1;
        bodyStart = -1;
      }
    }
  }
  return out;
}

/** 转换一个选择器列表(逗号分隔);返回新选择器或 null(全局,拒绝)。 */
function scopeSelectorList(
  selectorList: string,
  prefix: string,
  errors: string[],
): string {
  const parts = selectorList.split(",").map((s) => s.trim()).filter(Boolean);
  const scoped: string[] = [];
  for (const sel of parts) {
    // 拒绝全局选择器
    const firstToken = sel.split(/[ >+~]/)[0]?.trim() ?? "";
    if (GLOBAL_SELECTOR_TOKENS.has(firstToken) || sel === "*") {
      errors.push(`全局选择器被拒绝: "${sel}"`);
      continue;
    }
    // 顶层裸标签选择器(如 `div { }`)拒绝
    if (/^[a-zA-Z][\w-]*$/.test(firstToken) && HTML_TAGS.has(firstToken.toLowerCase())) {
      errors.push(`顶层标签选择器被拒绝: "${sel}"`);
      continue;
    }
    // class 前缀:.foo → .pw-extId-foo(避免重复前缀)
    const rewritten = sel.replace(/\.(-?[A-Za-z_][\w-]*)/g, (_m, name: string) =>
      name.startsWith(prefix) ? `.${name}` : `.${prefix}${name}`,
    );
    scoped.push(rewritten);
  }
  return scoped.join(", ");
}

/** 检查声明块内自定义变量是否越界(只允许 `--pw-<extId>-*`)。 */
function checkVars(body: string, varPrefix: string, errors: string[]): void {
  const re = /(^|[;{\s])(--[A-Za-z_][\w-]*)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const name = m[2] as string;
    if (!name.startsWith(varPrefix)) {
      errors.push(`自定义 CSS 变量需 ${varPrefix}* 前缀,拒绝定义: "${name}"`);
    }
  }
}

export function scopeCss(css: string, extId: string): ScopeCssResult {
  const errors: string[] = [];
  const prefix = `pw-${extId}-`;
  const varPrefix = `--pw-${extId}-`;

  // Tailwind preflight 检测(universal reset 会打到 `*`)
  if (
    /\*\s*,\s*::?before\s*,\s*::?after\s*\{/.test(css) ||
    /tailwindcss\s+v?\d/i.test(css) ||
    /@tailwind\s+base/.test(css)
  ) {
    errors.push("禁止 Tailwind preflight / universal reset 进入扩展 bundle");
  }

  // @keyframes 命名空间化 + 收集原名,用于改写 animation 引用。
  const animNames = new Set<string>();
  let work = css.replace(
    /@keyframes\s+(-?[A-Za-z_][\w-]*)/g,
    (_m, n: string) => {
      if (!n.startsWith(prefix)) animNames.add(n);
      return `@keyframes ${n.startsWith(prefix) ? n : prefix + n}`;
    },
  );
  // 改写 `animation` / `animation-name` 中对本扩展 keyframe 名的引用(否则名字对不上、动画失效)。
  for (const name of animNames) {
    work = work.replace(
      new RegExp(`(animation(?:-name)?\\s*:[^;}]*?)\\b${name}\\b`, "g"),
      (_m, pre: string) => `${pre}${prefix}${name}`,
    );
  }
  // @font-face 名命名空间化
  work = work.replace(
    /font-family\s*:\s*["']?(-?[A-Za-z_][\w-]*)["']?/g,
    (full: string, n: string) =>
      /@font-face/.test(css) && !n.startsWith(prefix)
        ? full.replace(n, prefix + n)
        : full,
  );

  // 遍历顶层规则做选择器 scoping(跳过 at-rule 的内层不二次 scope keyframes)
  const rules = splitRules(work);
  if (rules.length === 0) return { css: work, errors };

  const rebuilt: string[] = [];
  for (const { prelude, body } of rules) {
    if (prelude.startsWith("@")) {
      // @layer base 拒绝
      if (/^@layer\s+base\b/.test(prelude)) {
        errors.push("拒绝 @layer base(全局基础层)");
        continue;
      }
      // @keyframes/@font-face:保留内层不动(名字已命名空间化)
      if (/^@(keyframes|font-face)/.test(prelude)) {
        rebuilt.push(`${prelude} {${body}}`);
        continue;
      }
      // @media 等:递归 scope 内层
      const inner = scopeCss(body, extId);
      inner.errors.forEach((e) => errors.push(e));
      rebuilt.push(`${prelude} {${inner.css}}`);
      continue;
    }
    checkVars(body, varPrefix, errors);
    const scoped = scopeSelectorList(prelude, prefix, errors);
    if (scoped.length > 0) rebuilt.push(`${scoped} {${body}}`);
  }

  return { css: rebuilt.join("\n"), errors };
}
