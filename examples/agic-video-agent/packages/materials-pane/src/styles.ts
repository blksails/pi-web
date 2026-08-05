/** 素材 Pane 自带样式；Guest 主动注入，移植方无需复制宿主 CSS。 */
export const MATERIALS_PANE_CSS = String.raw`
:root{font:13px/1.6 ui-sans-serif,system-ui,"PingFang SC","Microsoft YaHei",sans-serif;color:#172033;background:#f8fafc;color-scheme:light}
*{box-sizing:border-box}html,body,#root{height:100%;margin:0}button,input{font:inherit;color:inherit}
button:focus-visible,input:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
.pane-layout{height:100%;min-height:0;display:flex;flex-direction:column;container:materials / inline-size}
.materials-view-tabs{display:flex;flex:none;align-items:center;gap:2px;min-height:30px;padding:3px 6px;border-bottom:1px solid #e2e8f0;background:#fff}
.materials-view-tabs button{display:inline-flex;height:24px;align-items:center;gap:4px;border:0;border-radius:7px;background:transparent;padding:0 7px;color:#64748b;cursor:pointer;font-size:11px}
.materials-view-tabs button:hover{background:#f1f5f9;color:#0f172a}.materials-view-tabs button.on{background:#eef2ff;color:#1d4ed8;box-shadow:inset 0 0 0 1px #c7d2fe}
.materials-view-tabs small{font-size:10px;color:#94a3b8}.materials-view-tabs small::before{content:"·";margin-right:4px}
.toolbar{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #e2e8f0;background:#fff}
.materials-toolbar{display:flex;flex-wrap:wrap;padding:9px 10px;container-type:inline-size}
.materials-toolbar>.toolbar-summary{display:flex;flex:none;flex-basis:auto;align-items:center;gap:4px;min-height:20px}
.toolbar-actions{display:flex;flex:none;align-items:center;gap:6px;min-width:0;margin-left:auto;overflow:visible;padding-bottom:1px}
.toolbar-actions::-webkit-scrollbar{display:none}
.grow{flex:1;min-width:0}
input{border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:8px 10px}
input[type=checkbox]{appearance:none;width:16px;height:16px;flex:none;margin:0;padding:0;border:1px solid hsl(var(--border,214 32% 91%));border-radius:4px;background:hsl(var(--background,0 0% 100%));color:hsl(var(--primary,222 47% 11%));display:grid;place-content:center;cursor:pointer;transition:background .15s,border-color .15s,box-shadow .15s}
input[type=checkbox]::after{content:"";width:8px;height:4px;border:solid currentColor;border-width:0 0 2px 2px;transform:rotate(-45deg) scale(0);transition:transform .12s ease}
input[type=checkbox]:checked{border-color:hsl(var(--primary,222 47% 11%));background:hsl(var(--primary,222 47% 11%));color:hsl(var(--primary-foreground,210 40% 98%))}
input[type=checkbox]:checked::after{transform:rotate(-45deg) scale(1)}
input[type=checkbox]:hover:not(:disabled){border-color:hsl(var(--primary,222 47% 11%));outline:3px solid hsl(var(--primary,222 47% 11%)/.12);outline-offset:0}
input[type=checkbox]:disabled{cursor:not-allowed;opacity:.45}
  .button{display:inline-flex;flex:none;align-items:center;height:30px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:5px 9px;cursor:pointer;white-space:nowrap}
  .button.primary{border-color:#2563eb;background:#2563eb;color:#fff}.button.danger{border-color:#fecaca;color:#b91c1c}.button.danger:hover{background:#fef2f2}
.button:disabled{opacity:.5;cursor:not-allowed}
.icon-button{display:inline-grid;flex:none;width:30px;height:30px;place-items:center;border:1px solid #d7dee9;border-radius:8px;background:#fff;color:#475569;cursor:pointer;transition:background .15s,color .15s,border-color .15s,transform .15s}
.icon-button:hover:not(:disabled){border-color:#b9c7d9;background:#f8fafc;color:#0f172a}.icon-button:active:not(:disabled){transform:scale(.94)}.icon-button:disabled{opacity:.45;cursor:not-allowed}.icon-button.primary{border-color:#2563eb;background:#2563eb;color:#fff}.icon-button.primary:hover:not(:disabled){background:#1d4ed8;color:#fff}
.action-button{position:relative;display:inline-flex;flex:none;height:30px;align-items:center;justify-content:center;gap:5px;border:1px solid #d7dee9;border-radius:8px;background:#fff;padding:0 9px;color:#475569;cursor:pointer;white-space:nowrap}
.action-button:hover:not(:disabled){border-color:#b9c7d9;background:#f8fafc;color:#0f172a}.action-button:disabled{opacity:.45;cursor:not-allowed}
@container(max-width:560px){.toolbar-actions{flex-basis:100%;flex-wrap:wrap;margin-left:0;padding-top:6px}}
.spin{animation:pane-spin .75s linear infinite}@keyframes pane-spin{to{transform:rotate(360deg)}}
.content{position:relative;display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;padding:0;overflow:hidden}.materials-scroll{min-height:0;padding:12px}.scroll{overflow:auto}
.center{height:100%;display:grid;place-items:center}.muted{color:#64748b}.error{color:#b91c1c}
.hint{cursor:help;opacity:.75}
.segs{display:inline-flex;flex:none;padding:2px;border-radius:8px;background:#f1f5f9;gap:2px}
.seg{border:0;background:none;padding:3px 8px;border-radius:6px;font-size:12px;color:#475569;cursor:pointer;white-space:nowrap}
.seg:hover{background:#e2e8f0}.seg.on{background:#fff;color:#0f172a;box-shadow:0 1px 2px rgb(0 0 0/.12)}
.day{position:sticky;top:0;z-index:1;padding:4px 2px;font-size:11px;color:#64748b;background:inherit}
.empty{min-height:160px;display:grid;place-items:center;color:#64748b;border:1px dashed #cbd5e1;border-radius:12px;background:#fff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px;margin-top:8px}
.split{flex:1;min-height:0;display:flex}
.side{position:relative;width:148px;flex:none;border-right:1px solid #e2e8f0;background:#fff}
.side-scroll{height:100%;padding:8px 6px;display:flex;flex-direction:column;gap:2px}
.side-resizer{position:absolute;right:0;top:0;z-index:10;width:6px;height:100%;transform:translateX(50%);cursor:col-resize;touch-action:none;background:transparent}
.side-resizer:hover,.side-resizer:focus-visible{background:#e2e8f0;outline:0}
.pager{display:grid;grid-template-columns:1fr auto 1fr;flex:none;min-height:42px;align-items:center;gap:5px;padding:6px 10px;border-top:1px solid #e2e8f0;background:rgb(255 255 255/.9);backdrop-filter:blur(12px);opacity:0;pointer-events:none;translate:0 3px;transition:opacity .16s ease,translate .16s ease}
.content.has-pager:hover .pager,.content.has-pager:focus-within .pager{opacity:1;pointer-events:auto;translate:0 0}
.pager-button{min-width:0;height:28px;border:0;border-radius:0;background:transparent;color:#64748b;padding:0;cursor:pointer}
.pager-button:first-child{justify-self:start}.pager-button:last-child{justify-self:end}
.pager-button:hover:not(:disabled){color:#0f172a}.pager-button:disabled{opacity:.4;cursor:not-allowed}
.pager-page{display:flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap}
.pager-input{height:24px;padding:2px 4px;text-align:center;font-variant-numeric:tabular-nums;-moz-appearance:textfield}
.pager-input::-webkit-inner-spin-button,.pager-input::-webkit-outer-spin-button{margin:0;appearance:none}
.pager-confirm{height:24px;border:1px solid hsl(var(--primary,222 47% 11%));border-radius:4px;background:hsl(var(--primary,222 47% 11%));color:hsl(var(--primary-foreground,210 40% 98%));padding:2px 7px;font-size:12px;line-height:18px;cursor:pointer}
.pager-confirm:hover{opacity:.88}
.tree-row{display:flex;align-items:center;gap:2px;border-radius:7px;padding:1px 2px}
.tree-row.on{background:#eef2ff}
.tree-name{flex:1;min-width:0;text-align:left;border:0;background:none;padding:5px 6px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tree-twist{flex:none;width:14px;border:0;background:none;padding:0;color:#94a3b8;cursor:pointer;display:grid;place-items:center}
  .tree-count{flex:none;padding:0 4px;font-size:11px;color:#94a3b8;font-variant-numeric:tabular-nums}
  .tree-act{flex:none;width:0;overflow:hidden;border:0;background:none;padding:0;border-radius:6px;color:#94a3b8;cursor:pointer;display:grid;place-items:center;opacity:0;pointer-events:none}
  .tree-row:hover .tree-count,.tree-row:focus-within .tree-count{display:none}.tree-row:hover .tree-act,.tree-row:focus-within .tree-act,.tree-act.open{width:22px;padding:4px;opacity:1;pointer-events:auto;color:#475569}.tree-act:hover{background:#e2e8f0}
.notice{margin:8px 12px 0;padding:6px 10px;border:1px solid #fcd34d;background:#fffbeb;color:#92400e;border-radius:8px;font-size:12px;cursor:pointer}
.content.dropping{outline:2px dashed #2563eb;outline-offset:-6px;background:#eff6ff}
.asset-card{min-width:0}
.asset{position:relative;border:1px solid #e2e8f0;border-radius:10px;background:#fff;overflow:hidden;aspect-ratio:1}
.asset[draggable=true],.asset[data-pointer-draggable=true]{cursor:grab}.asset.sel{outline:2px solid #2563eb;outline-offset:-2px}
.pointer-drag-ghost{position:fixed;z-index:90;pointer-events:none;opacity:.82;box-shadow:0 16px 38px rgb(15 23 42/.28)}
body.pointer-material-dragging,body.pointer-material-dragging *{cursor:grabbing!important;user-select:none}
.asset-img{display:block;width:100%;height:100%;object-fit:contain;background:#f1f5f9;opacity:0;transition:opacity .25s;cursor:pointer}
.asset-img.loaded{opacity:1}
.asset-unavailable{display:grid;width:100%;height:100%;place-content:center;justify-items:center;gap:7px;border:0;background:linear-gradient(145deg,#f1f5f9,#fff);color:#94a3b8;cursor:pointer}
.asset-unavailable>span{font-size:11px}
.audio-card{display:grid;width:100%;height:100%;place-items:center;border:0;background:linear-gradient(145deg,#eef2ff,#f8fafc);color:#6366f1;cursor:pointer}
.asset-shimmer{position:absolute;inset:0;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 37%,#f1f5f9 63%);background-size:400% 100%;animation:pane-shimmer 1.4s ease infinite}
@keyframes pane-shimmer{0%{background-position:100% 50%}100%{background-position:0 50%}}
.asset-ck{position:absolute;left:6px;top:6px;width:18px;height:18px;border-radius:5px;border:1px solid #cbd5e1;background:rgb(255 255 255/.9);color:#2563eb;font-size:11px;line-height:1;display:grid;place-items:center;cursor:pointer;opacity:0;transition:opacity .15s}
.asset:hover .asset-ck,.asset-ck.on,.asset-ck.any{opacity:1}.asset-ck.on{border-color:#2563eb}
.asset-menu{position:absolute;right:6px;top:6px;width:22px;height:22px;border-radius:6px;border:none;background:rgb(20 22 35/.66);color:#fff;cursor:pointer;opacity:0;transition:opacity .15s;display:grid;place-items:center}
.asset:hover .asset-menu{opacity:1}
.asset-name{display:block;width:fit-content;max-width:calc(100% - 8px);margin:6px 4px 0;padding:2px 7px;border:1px solid rgb(255 255 255/.18);border-radius:999px;font-size:11px;line-height:17px;color:#fff;background:rgb(15 23 42/.54);backdrop-filter:blur(9px) saturate(1.2);box-shadow:0 2px 8px rgb(15 23 42/.16);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.distribution-badge-wrap{position:absolute;left:4px;bottom:4px;z-index:10;pointer-events:auto}
.distribution-badge{display:inline-flex;align-items:center;gap:4px;min-height:18px;padding:2px 4px;border:1px solid rgb(255 255 255/.6);border-radius:999px;color:#fff;background:#16a34a;box-shadow:0 2px 6px rgb(15 23 42/.22)!important;cursor:default;font-size:10px;line-height:1}
.distribution-badge:hover,.distribution-badge:focus-visible{border-color:#fff;outline:2px solid rgb(255 255 255/.9);outline-offset:1px}
.distribution-badge.uploading{background:#d97706}.distribution-badge.failed{background:#dc2626}.distribution-badge.replaced{background:#64748b}.distribution-badge.mixed{background:rgb(20 20 24/.9)}
.distribution-badge-segment{display:inline-flex;align-items:center;gap:2px}.distribution-badge.mixed .distribution-badge-segment.failed{color:#fca5a5}.distribution-badge.mixed .distribution-badge-segment.uploading{color:#fcd34d}.distribution-badge.mixed .distribution-badge-segment.replaced{color:#cbd5e1}.distribution-badge.mixed .distribution-badge-segment.done{color:#86efac}.distribution-badge svg{width:12px;height:12px}.distribution-badge small{font-size:9px;font-variant-numeric:tabular-nums}
.distribution-tooltip{position:fixed;z-index:100;width:max-content;max-width:240px;padding:4px 8px;border:1px solid hsl(var(--border,214 32% 91%)/.9);border-radius:6px;background:hsl(var(--popover,0 0% 100%));color:hsl(var(--popover-foreground,222 47% 11%));box-shadow:0 8px 24px rgb(15 23 42/.24)!important;font-size:9px;line-height:1.25;pointer-events:auto}
.distribution-tooltip ul{display:grid;gap:4px;margin:0;padding:0;list-style:none}.distribution-tooltip li{padding-top:4px;border-top:1px solid hsl(var(--border,214 32% 91%)/.4)}.distribution-tooltip li:first-child{padding-top:0;border-top:0}
.distribution-row-head,.distribution-row-detail{display:flex;align-items:center;gap:5px;min-width:0}.distribution-row-icon{width:12px;height:12px;flex:none}.distribution-row-icon.done{color:#16a34a}.distribution-row-icon.uploading{color:#d97706}.distribution-row-icon.failed{color:#dc2626}.distribution-row-icon.replaced{color:#64748b}.distribution-account,.distribution-row-detail>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.distribution-status-text{margin-left:auto;font-weight:600}.distribution-status-text.done{color:#16a34a}.distribution-status-text.uploading{color:#d97706}.distribution-status-text.failed{color:#dc2626}.distribution-status-text.replaced{color:#64748b}
.distribution-row-detail{margin-top:2px;padding-left:17px;color:#64748b}.distribution-row-detail time{margin-left:auto;white-space:nowrap}.distribution-row-detail.failed{color:#b91c1c}.distribution-row-detail.failed>span{flex:1}.distribution-row-detail em{color:#92400e;font-style:normal;white-space:nowrap}.distribution-row-detail button{display:inline-flex;align-items:center;gap:3px;flex:none;padding:2px 5px;border:1px solid #fecaca;border-radius:5px;background:#fff;color:#b91c1c;cursor:pointer;font-size:10px}.distribution-row-detail button:hover:not(:disabled){background:#fef2f2}.distribution-row-detail button:disabled{cursor:wait;opacity:.65}
.distribution-replace-actions{display:flex;gap:4px;margin-top:5px;padding-top:5px;border-top:1px solid hsl(var(--border,214 32% 91%)/.55)}.distribution-replace-actions button{flex:1;padding:3px 6px;border:1px solid hsl(var(--border,214 32% 91%));border-radius:5px;background:transparent;color:inherit;cursor:pointer;font-size:10px}.distribution-replace-actions button:hover{background:hsl(var(--foreground,222 47% 11%)/.08)}
.hover-preview{position:fixed;z-index:55;display:flex;flex-direction:column;align-items:stretch;border:1px solid hsl(var(--border,214 32% 91%)/.82);border-radius:14px;background:hsl(var(--background,0 0% 100%));box-shadow:0 10px 26px rgb(15 23 42/.22),0 2px 8px rgb(15 23 42/.12);overflow:hidden;pointer-events:none}
.hover-preview>img,.hover-preview>video{display:block;width:auto;height:auto;max-width:100%;max-height:330px;background:transparent}
.hover-audio{display:grid;min-height:150px;place-items:center;gap:10px;padding:18px;border-radius:8px;background:linear-gradient(145deg,#eef2ff,#f8fafc);color:#6366f1}.hover-audio audio{width:100%}
.initial-loading{align-content:center;gap:8px}.refresh-indicator{position:absolute;right:10px;top:10px;z-index:5;display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid rgb(203 213 225/.72);border-radius:999px;background:rgb(255 255 255/.82);backdrop-filter:blur(10px);box-shadow:0 6px 18px rgb(15 23 42/.12);color:#475569;font-size:11px;pointer-events:none}
.asset-backdrop{position:fixed;inset:0;z-index:40}
.asset-pop{position:fixed;z-index:41;min-width:150px;padding:4px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;box-shadow:0 10px 30px rgb(0 0 0/.18);display:flex;flex-direction:column}
.asset-pop>button{display:block;width:100%;text-align:left;border:0;background:none;padding:7px 10px;border-radius:7px;cursor:pointer;white-space:nowrap}
  .asset-pop>button:hover:not(:disabled){background:#f1f5f9}.asset-pop>button:disabled{color:#94a3b8;cursor:not-allowed}
  .folder-pop{min-width:164px}.folder-pop>button{display:flex;align-items:center;gap:8px}.folder-pop>button.danger{color:#b91c1c}.folder-pop>button.danger:hover{background:#fef2f2}
.pop-sep{height:1px;margin:4px 2px;background:#e2e8f0}.pop-sub{display:flex;gap:4px;padding:2px}
.pop-input{flex:1;min-width:0;padding:5px 7px}.pop-sub>button{border:1px solid #cbd5e1;border-radius:7px;background:none;padding:4px 9px;cursor:pointer}
.dlg-backdrop{position:fixed;inset:0;z-index:45;display:grid;place-items:center;padding:24px;background:rgb(0 0 0/.35)}
.dlg{display:flex;flex-direction:column;width:min(360px,100%);max-height:70vh;border:1px solid #e2e8f0;border-radius:12px;background:#fff;overflow:hidden;box-shadow:0 20px 60px rgb(0 0 0/.3)}
.dlg-head{padding:11px 14px;border-bottom:1px solid #e2e8f0;font-weight:600}
  .dlg-body{padding:6px;display:flex;flex-direction:column;gap:2px}.dlg-row{text-align:left;border:0;background:none;padding:8px 10px;border-radius:8px;cursor:pointer}
  .dlg-form{display:flex;flex-direction:column;gap:7px;padding:14px}.dlg-form>label{font-size:12px;color:#64748b}.dlg-row:hover{background:#f1f5f9}.dlg-foot{padding:8px 12px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:7px}
.rename-row,.advertiser-row{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:8px}.rename-row>span{width:22px;text-align:right;color:#94a3b8}.rename-row>input{flex:1;min-width:0}.advertiser-row:hover{background:#f1f5f9}.advertiser-row>input{flex:none}.advertiser-row>span{flex:1}.advertiser-row>small{color:#94a3b8}
.move-tree-row{display:flex;min-width:0;align-items:center}.move-tree-row>.dlg-row{min-width:0;flex:1}.move-tree-twist{display:grid;width:22px;height:26px;flex:none;place-items:center;border:0;background:transparent;color:#94a3b8;cursor:pointer}
.ilb{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgb(8 10 18/.88);overflow:hidden}
.ilb-stage{max-width:92vw;max-height:88vh;display:grid;place-items:center;overflow:hidden}
.ilb-img{max-width:92vw;max-height:88vh;object-fit:contain;transition:transform .12s ease-out;user-select:none;-webkit-user-drag:none}
.ilb-x{position:fixed;top:14px;right:16px;width:34px;height:34px;border-radius:50%;border:none;background:rgb(255 255 255/.12);color:#fff;cursor:pointer;display:grid;place-items:center}
.ilb-x:hover{background:rgb(255 255 255/.22)}
.ilb-nav{position:fixed;top:50%;translate:0 -50%;width:44px;height:64px;border:none;border-radius:10px;background:rgb(255 255 255/.1);color:#fff;cursor:pointer;display:grid;place-items:center}
.ilb-nav:hover{background:rgb(255 255 255/.2)}.ilb-nav.left{left:16px}.ilb-nav.right{right:16px}
.ilb-tools{position:fixed;left:50%;bottom:22px;translate:-50% 0;display:flex;align-items:center;gap:2px;padding:5px 8px;border-radius:12px;background:rgb(255 255 255/.1);backdrop-filter:blur(8px);color:#fff}
.ilb-tools button{width:30px;height:28px;border:none;border-radius:7px;background:none;color:#fff;cursor:pointer;display:grid;place-items:center}
.ilb-tools button:hover{background:rgb(255 255 255/.18)}.ilb-tools button.on{background:rgb(37 99 235/.75)}
.ilb-tools .pct{min-width:44px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums}
.ilb-tools .sep{width:1px;height:16px;margin:0 4px;background:rgb(255 255 255/.25)}
.ilb-count{position:fixed;left:50%;top:16px;translate:-50% 0;color:rgb(255 255 255/.8);font-size:12px}
.ilb-dims{position:fixed;right:16px;bottom:22px;color:rgb(255 255 255/.65);font-size:12px;font-variant-numeric:tabular-nums}
@media(prefers-color-scheme:dark){:root{color:#e2e8f0;background:#0f172a;color-scheme:dark}
.materials-view-tabs,.toolbar,input,.button,.icon-button,.action-button,.empty,.side,.asset,.asset-pop,.dlg{background:#111827;border-color:#334155}
.materials-view-tabs button:hover{background:#1e293b;color:#e2e8f0}.materials-view-tabs button.on{background:#1e293b;color:#93c5fd;box-shadow:inset 0 0 0 1px #334155}
.muted{color:#94a3b8}.tree-row.on{background:#1e293b}.tree-add{border-color:#334155}
.asset-img{background:#1e293b}.asset-unavailable{background:linear-gradient(145deg,#1e293b,#111827);color:#64748b}.asset-shimmer{background:linear-gradient(90deg,#1e293b 25%,#334155 37%,#1e293b 63%);background-size:400% 100%}
.audio-card,.hover-audio{background:linear-gradient(145deg,#1e293b,#111827)}.refresh-indicator{border-color:rgb(51 65 85/.82);background:rgb(17 24 39/.82);color:#cbd5e1}.pager{border-color:#334155;background:rgb(17 24 39/.9)}
.asset-ck{background:rgb(17 24 39/.9);border-color:#334155}
.asset-pop>button:hover:not(:disabled),.dlg-row:hover,.advertiser-row:hover{background:#1e293b}
.pop-sep,.dlg-head,.dlg-foot{border-color:#334155}
.segs{background:#1e293b}.seg{color:#94a3b8}.seg:hover{background:#334155}.seg.on{background:#0f172a;color:#e2e8f0}
.notice{background:#422006;border-color:#a16207;color:#fde68a}.content.dropping{background:#0b1220}}

/* Host-theme layer: Pane 不自定品牌色，全部取宿主 token。 */
:root{
  color:hsl(var(--foreground,222 47% 11%));
  background:hsl(var(--background,0 0% 100%));
  color-scheme:normal;
}
*{scrollbar-width:thin;scrollbar-color:hsl(var(--muted-foreground,215 16% 47%)/.38) transparent}
*::-webkit-scrollbar{width:7px;height:7px}
*::-webkit-scrollbar-track{background:transparent}
*::-webkit-scrollbar-thumb{border:2px solid transparent;border-radius:999px;background:hsl(var(--muted-foreground,215 16% 47%)/.38);background-clip:padding-box}
*::-webkit-scrollbar-thumb:hover{background:hsl(var(--muted-foreground,215 16% 47%)/.58);background-clip:padding-box}
button:focus-visible,input:focus-visible,select:focus-visible{outline-color:hsl(var(--ring,222 47% 11%))}
.pane-layout{background:hsl(var(--background,0 0% 100%));color:hsl(var(--foreground,222 47% 11%))}
.materials-workbench{
  display:grid;
    grid-template-columns:minmax(120px,var(--materials-library-size,38%)) 6px minmax(300px,1fr);
  flex:1;
  min-height:0;
  overflow:hidden;
  background:hsl(var(--background,0 0% 100%));
  gap:0;
}
.materials-workbench[data-view="library"],
.materials-workbench[data-view="directory"]{grid-template-columns:minmax(0,1fr)}
.materials-workbench[data-stacked="true"][data-view="both"]{
  grid-template-columns:minmax(0,1fr);
  grid-template-rows:minmax(150px,var(--materials-library-size,38%)) 6px minmax(240px,1fr);
}
.track-resizer{
  position:relative;
  z-index:8;
  min-width:0;
  min-height:0;
  border:0;
  background:transparent;
  cursor:col-resize;
  touch-action:none;
}
.track-resizer::after{
  content:"";
  position:absolute;
  inset-block:0;
  left:50%;
  width:1px;
  translate:-50% 0;
  background:hsl(var(--border,214 32% 91%));
  transition:width .12s ease,background .12s ease;
}
.track-resizer:hover::after,.track-resizer:focus-visible::after{
  width:3px;
  background:hsl(var(--ring,222 47% 11%)/.46);
}
.materials-workbench[data-stacked="true"]>.track-resizer{cursor:row-resize}
.materials-workbench[data-stacked="true"]>.track-resizer::after{
  inset-inline:0;
  top:50%;
  width:auto;
  height:1px;
  translate:0 -50%;
}
.materials-workbench[data-stacked="true"]>.track-resizer:hover::after,
.materials-workbench[data-stacked="true"]>.track-resizer:focus-visible::after{height:3px;width:auto}
.material-track{
  position:relative;
  display:flex;
  min-width:0;
  min-height:0;
  flex-direction:column;
  overflow:hidden;
  background:hsl(var(--background,0 0% 100%));
}
.track-header{
  display:flex;
  min-height:34px;
  flex:none;
  align-items:center;
  gap:7px;
  padding:4px 8px;
  border-bottom:1px solid hsl(var(--border,214 32% 91%));
  background:hsl(var(--background,0 0% 100%)/.94);
}
.track-header>small{color:hsl(var(--muted-foreground,215 16% 47%));white-space:nowrap}
.track-title{display:inline-flex;flex:none;align-items:center;gap:5px;white-space:nowrap}
.track-title>strong{font-size:13px;font-weight:600}
.track-title>span{
  min-width:18px;
  border-radius:999px;
  padding:0 5px;
  background:hsl(var(--muted,210 40% 96%));
  color:hsl(var(--muted-foreground,215 16% 47%));
  font-size:10px;
  line-height:18px;
  text-align:center;
}
.track-scroll{flex:1;min-height:0;padding:8px}
.track-scroll .grid{grid-template-columns:repeat(auto-fill,minmax(104px,1fr))}
.library-track.dropping,.content.dropping{
  outline:2px dashed hsl(var(--primary,222 47% 11%));
  outline-offset:-5px;
  background:hsl(var(--accent,210 40% 96%));
}
.directory-header{display:block;padding:4px 8px}
.directory-header>.track-title{height:24px}
.directory-toolbar{display:flex;min-width:0;align-items:center;gap:6px}
.directory-toolbar .toolbar-summary{display:inline-flex;align-items:center;gap:3px;white-space:nowrap}
.directory-toolbar .toolbar-actions{margin-left:auto;gap:4px}
.directory-toolbar .action-button{flex:0 0 auto;height:28px;max-width:132px;padding:0 8px}
.directory-toolbar .action-button>span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.directory-toolbar .overflow-button{width:28px;padding:0}
.directory-toolbar .action-button.primary{
  border-color:hsl(var(--primary,222 47% 11%));
  background:hsl(var(--primary,222 47% 11%));
  color:hsl(var(--primary-foreground,210 40% 98%));
}
@container materials (max-width:560px){
  .directory-toolbar{flex-wrap:wrap}
  .directory-toolbar .toolbar-actions{flex-basis:100%;justify-content:flex-start;margin-left:0;padding-top:2px}
}
.toolbar-pop{min-width:190px}
.toolbar-pop>button{display:flex;align-items:center;gap:8px}
.segs{background:hsl(var(--muted,210 40% 96%))}
.seg{color:hsl(var(--muted-foreground,215 16% 47%))}
.seg:hover{background:hsl(var(--accent,210 40% 96%));color:hsl(var(--accent-foreground,222 47% 11%))}
.seg.on{
  background:hsl(var(--background,0 0% 100%));
  color:hsl(var(--foreground,222 47% 11%));
  box-shadow:0 0 0 1px hsl(var(--border,214 32% 91%)),0 1px 2px hsl(var(--foreground,222 47% 11%)/.08);
}
.side,.asset,.empty,.asset-pop,.dlg,input,select,.button,.icon-button,.action-button{
  border-color:hsl(var(--border,214 32% 91%));
  background:hsl(var(--background,0 0% 100%));
  color:hsl(var(--foreground,222 47% 11%));
}
.side{width:136px;background:hsl(var(--background,0 0% 100%))}
.side-scroll{padding:4px;gap:0}
.tree-sticky{
  position:sticky;
  top:0;
  z-index:3;
  padding-bottom:4px;
  background:hsl(var(--background,0 0% 100%));
}
.tree-create-row{display:grid;grid-template-columns:1fr 1fr;gap:3px;padding:2px}
.tree-create-row>button{
  display:inline-flex;
  height:25px;
  min-width:0;
  align-items:center;
  justify-content:center;
  gap:4px;
  border:1px dashed hsl(var(--border,214 32% 91%));
  border-radius:6px;
  background:transparent;
  color:hsl(var(--muted-foreground,215 16% 47%));
  cursor:pointer;
  font-size:11px;
  white-space:nowrap;
}
.tree-create-row>button:hover{border-style:solid;background:hsl(var(--accent,210 40% 96%));color:hsl(var(--foreground,222 47% 11%))}
.tree-row{min-height:25px;padding-block:0}
.tree-row.on{background:hsl(var(--accent,210 40% 96%))}
.tree-name{padding:3px 4px}
.tree-twist{width:12px}
.tree-count{padding:0 2px}
.tree-row:hover .tree-act,.tree-row:focus-within .tree-act,.tree-act.open{padding:3px}
.side-resizer:hover,.side-resizer:focus-visible{background:hsl(var(--border,214 32% 91%))}
.pager{
  min-height:36px;
  padding:4px 8px;
  border-color:hsl(var(--border,214 32% 91%));
  background:hsl(var(--background,0 0% 100%)/.94);
  opacity:1;
  pointer-events:auto;
  translate:0;
}
.asset.sel{outline-color:hsl(var(--primary,222 47% 11%))}
.asset-ck{color:hsl(var(--primary,222 47% 11%))}
.asset-ck.on{border-color:hsl(var(--primary,222 47% 11%))}
.audio-card,.hover-audio{background:hsl(var(--muted,210 40% 96%));color:hsl(var(--foreground,222 47% 11%))}
.asset-img,.asset-unavailable{background:hsl(var(--muted,210 40% 96%))}
.asset-shimmer{
  background:linear-gradient(90deg,hsl(var(--muted,210 40% 96%)) 25%,hsl(var(--border,214 32% 91%)) 37%,hsl(var(--muted,210 40% 96%)) 63%);
  background-size:400% 100%;
}
.notice{
  border-color:hsl(var(--border,214 32% 91%));
  background:hsl(var(--popover,0 0% 100%));
  color:hsl(var(--popover-foreground,222 47% 11%));
}
.materials-view-tabs{
  border-color:hsl(var(--border,214 32% 91%));
  background:hsl(var(--background,0 0% 100%));
}
.materials-view-tabs button{color:hsl(var(--muted-foreground,215 16% 47%))}
.materials-view-tabs button:hover{
  background:hsl(var(--accent,210 40% 96%));
  color:hsl(var(--accent-foreground,222 47% 11%));
}
.materials-view-tabs button.on{
  background:hsl(var(--muted,210 40% 96%));
  color:hsl(var(--foreground,222 47% 11%));
  box-shadow:inset 0 0 0 1px hsl(var(--border,214 32% 91%));
}
.refresh-indicator{
  border-color:hsl(var(--border,214 32% 91%)/.8);
  background:hsl(var(--popover,0 0% 100%)/.86);
  color:hsl(var(--popover-foreground,222 47% 11%));
}
.rename-rule-form{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid hsl(var(--border,214 32% 91%))}
.rename-rule-form>label{display:flex;flex-direction:column;gap:4px}
.rename-rule-form input,.rename-rule-form select{width:100%;padding:6px 8px}
.rename-preview{min-height:140px}
.rename-thumb{display:grid;width:42px;height:42px;flex:none;place-items:center;overflow:hidden;border:1px solid hsl(var(--border,214 32% 91%));border-radius:7px;background:hsl(var(--muted,210 40% 96%));color:hsl(var(--muted-foreground,215 16% 47%))}
.rename-row>.rename-thumb{width:42px;text-align:center}
.rename-thumb img,.rename-thumb video{display:block;width:100%;height:100%;object-fit:cover}
.rename-thumb.audio{background:hsl(var(--accent,210 40% 96%));color:hsl(var(--primary,222 47% 11%))}
.button-primary,.button.primary{
  border-color:hsl(var(--primary,222 47% 11%));
  background:hsl(var(--primary,222 47% 11%));
  color:hsl(var(--primary-foreground,210 40% 98%));
}
@container materials (max-width:520px){
  .track-header>small{display:none}
  .directory-toolbar{align-items:flex-start;flex-wrap:wrap}
  .directory-toolbar .toolbar-actions{margin-left:0}
  .directory-toolbar .toolbar-summary{margin-left:auto}
  .rename-rule-form{grid-template-columns:1fr}
}
.directory-toolbar[data-toolbar-tier="0"]{align-items:center;flex-wrap:nowrap}
.directory-toolbar[data-toolbar-tier="0"] .toolbar-actions{flex-basis:auto;justify-content:flex-start;margin-left:auto;padding-top:0}
*,*::before,*::after{box-shadow:none!important}
.asset{border:0}
`;

export function installMaterialsPaneStyles(doc: Document = document): void {
  if (doc.getElementById("materials-pane-styles") !== null) return;
  const style = doc.createElement("style");
  style.id = "materials-pane-styles";
  style.textContent = MATERIALS_PANE_CSS;
  doc.head.appendChild(style);
}
