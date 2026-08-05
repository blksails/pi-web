/** 搜索 Pane 自带样式；移植方无需复制宿主 CSS。 */
export const SEARCH_PANE_CSS = String.raw`
:root{font:13px/1.6 ui-sans-serif,system-ui,"PingFang SC","Microsoft YaHei",sans-serif;color:hsl(var(--foreground,0 0% 9%));background:hsl(var(--background,0 0% 100%));color-scheme:light dark}
*{box-sizing:border-box}html,body,#root{height:100%;margin:0}button,input{font:inherit;color:inherit}
button:focus-visible,input:focus-visible{outline:2px solid hsl(var(--ring,0 0% 9%));outline-offset:2px}
.pane-layout{height:100%;min-height:0;display:flex;flex-direction:column}
.toolbar{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid hsl(var(--border,0 0% 89%));background:hsl(var(--background,0 0% 100%))}
.pane-header{position:sticky;top:0;z-index:2;background:color-mix(in srgb,hsl(var(--background,0 0% 100%)) 88%,transparent);backdrop-filter:blur(12px)}
.grow{flex:1;min-width:0}.content{padding:12px}.scroll{overflow:auto}
.search-field{display:flex;align-items:center;gap:7px;min-width:0;padding:0 9px;border:1px solid hsl(var(--border,0 0% 89%));border-radius:9px;background:hsl(var(--background,0 0% 100%));color:hsl(var(--muted-foreground,0 0% 45%))}
.search-field:focus-within{border-color:hsl(var(--ring,0 0% 9%));box-shadow:0 0 0 3px hsl(var(--ring,0 0% 9%)/.12)}
.search-field input{width:100%;min-width:0;border:0;padding:7px 0;outline:0;background:transparent}
.icon-button{display:inline-grid;flex:none;width:30px;height:30px;place-items:center;border:1px solid hsl(var(--border,0 0% 89%));border-radius:8px;background:hsl(var(--background,0 0% 100%));color:hsl(var(--muted-foreground,0 0% 45%));cursor:pointer;transition:background .15s,color .15s,border-color .15s,transform .15s}
.icon-button:hover:not(:disabled){border-color:hsl(var(--border,0 0% 89%));background:hsl(var(--accent,0 0% 96%));color:hsl(var(--foreground,0 0% 9%))}.icon-button:active:not(:disabled){transform:scale(.94)}.icon-button:disabled{opacity:.45;cursor:not-allowed}.icon-button.primary{border-color:hsl(var(--primary,0 0% 9%));background:hsl(var(--primary,0 0% 9%));color:hsl(var(--primary-foreground,0 0% 100%))}.icon-button.primary:hover:not(:disabled){background:hsl(var(--primary,0 0% 9%));color:hsl(var(--primary-foreground,0 0% 100%))}
.spin{animation:search-pane-spin .75s linear infinite}@keyframes search-pane-spin{to{transform:rotate(360deg)}}
.center{height:100%;display:grid;place-items:center}.muted{color:hsl(var(--muted-foreground,0 0% 45%))}.error{color:#b91c1c}
.empty{min-height:160px;display:grid;place-items:center;color:hsl(var(--muted-foreground,0 0% 45%));background:transparent}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px;margin-top:4px}
.card{margin:0;border:0;border-radius:8px;background:transparent;overflow:visible}
.card img{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px}.noimg{display:grid;place-items:center;aspect-ratio:1;border-radius:8px;color:hsl(var(--muted-foreground,0 0% 45%));background:hsl(var(--muted,0 0% 96%))}
figcaption{display:flex;align-items:center;gap:6px;padding:5px 2px 0;font-size:12px}.badge{flex:none;padding:0;font-size:10px;color:hsl(var(--muted-foreground,0 0% 45%))}.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:hsl(var(--muted-foreground,0 0% 45%))}
@media(prefers-color-scheme:dark){:root{color:#e2e8f0;background:#0f172a;color-scheme:dark}.toolbar,.card,.search-field,.empty{background:#111827;border-color:#334155}.noimg{background:#1e293b}.muted,.name{color:#94a3b8}}
.image-query{display:flex;height:32px;min-width:0;flex:1;align-items:center;gap:7px}.image-query>img{width:25px;height:25px;border-radius:6px;object-fit:cover}.image-query>span{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.image-query>button{display:grid;width:24px;height:24px;place-items:center;border:0;border-radius:6px;background:transparent;cursor:pointer}
.result-filters{display:flex;align-items:center;gap:3px;padding:5px 10px;border-bottom:1px solid hsl(var(--border,0 0% 89%));background:hsl(var(--background,0 0% 100%))}.result-filters>button{height:25px;border:0;border-radius:7px;background:transparent;padding:0 8px;color:hsl(var(--muted-foreground,0 0% 45%));cursor:pointer;font-size:11px}.result-filters>button.on{background:hsl(var(--accent,0 0% 96%));color:hsl(var(--foreground,0 0% 9%))}.result-filters>span{margin-left:auto;color:hsl(var(--muted-foreground,0 0% 45%));font-size:11px}
.preview-button{position:relative;display:block;width:100%;border:0;background:transparent;padding:0;cursor:pointer}.preview-button:disabled{cursor:default}.cluster-count{position:absolute;right:7px;bottom:7px;display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:999px;background:rgb(15 23 42/.55);backdrop-filter:blur(9px);color:#fff;font-size:10px}
.preview-dialog{position:fixed;inset:0;z-index:50;display:grid;place-items:center;padding:24px;background:rgb(15 23 42/.72);backdrop-filter:blur(8px)}.preview-dialog>img{max-width:92vw;max-height:88vh;border-radius:12px;object-fit:contain}.preview-dialog>button{position:fixed;right:18px;top:18px;display:grid;width:34px;height:34px;place-items:center;border:1px solid rgb(255 255 255/.2);border-radius:999px;background:rgb(15 23 42/.5);color:#fff;cursor:pointer}
:root{color:hsl(var(--foreground,0 0% 9%));background:hsl(var(--background,0 0% 100%));color-scheme:light dark}.toolbar,.card,.search-field,.empty{border-color:hsl(var(--border,0 0% 89%));background:hsl(var(--background,0 0% 100%))}.icon-button{border-color:hsl(var(--border,0 0% 89%));background:hsl(var(--background,0 0% 100%));color:hsl(var(--muted-foreground,0 0% 45%))}.icon-button.primary{border-color:hsl(var(--primary,0 0% 9%));background:hsl(var(--primary,0 0% 9%));color:hsl(var(--primary-foreground,0 0% 100%))}.badge{background:hsl(var(--accent,0 0% 96%));color:hsl(var(--accent-foreground,0 0% 9%))}.name,.muted{color:hsl(var(--muted-foreground,0 0% 45%))}
*,*::before,*::after{box-shadow:none!important}
`;

export function installSearchPaneStyles(doc: Document = document): void {
  if (doc.getElementById("search-pane-styles") !== null) return;
  const style = doc.createElement("style");
  style.id = "search-pane-styles";
  style.textContent = SEARCH_PANE_CSS;
  doc.head.appendChild(style);
}
