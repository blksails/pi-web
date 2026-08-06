/**
 * 默认 pane 文档包装器（边车 chrome）：每个 pane realm 顶部的全局 tabs 条。
 *
 * ## 为何是包装器、且默认开启（底层注入，不依赖业务文档自觉 wrap）
 *
 * 宿主不再渲染固定 header（native child 满格叠井）。chrome **只在载体底层注入**，
 * agent/业务构建**禁止**再各自 wrap（避免双份边车、版本漂移）：
 * - **inline**：`PanesHost` → `withDefaultPaneChrome`（force 剥旧 + paneId 握手）。
 * - **URL / native**：`paneChromeBootScript` → Tauri `initialization_script`（+ URL `pi-pane-id`）。
 * - **构建产物**：只交业务 HTML/JS，不写 `data-pi-pane-chrome` / `pane-chrome.js`。
 *
 * ## Tab 状态跨 iframe / WebView 同步（唯一源）
 *
 * - **唯一事实源**：宿主 `PanesHost` 的 workspace（开/关/激活/park）。
 * - **下行同步**：宿主对**每一个**已连接 realm（iframe 与 native child 一视同仁）
 *   广播 `pane:signal` name=`PANE_CHROME_SIGNAL`（`pi.workspace`），payload 为全量快照。
 *   各边车只是只读视图，**禁止**本地维护独立 tab 列表。
 * - **上行动作**：边车点 tab/关/开/刷新 → `pane:request` workspace.* → 宿主改 workspace
 *   → 再广播快照到全部 realm。任一 webview 内操作，其它 webview 头部同步更新。
 * - **握手**：与 pane guest 共用 `pane:connected` 的 ports[0]；native 顶层 source===window。
 *
 * ## 「更多」按钮
 *
 * 显示条件：宽度放不下的 **溢出 open tabs**，或已 park 的 hidden 实例。
 * 弹层列出溢出 + 收起项；全可见且无 park 时隐藏按钮。
 *
 * ## 与 guest 共用 port
 *
 * guest `connectPaneGuest` 经 `__PI_PANE_PORT__` / `pi-pane-port` 发布 MessagePort；
 * 边车优先用该口，避免与 guest 抢 `pane:connected` 事件、rebind 关口导致点击失效。
 */

import type { PaneDocument, PaneDefinition, PanesDefinition } from "./contract.js";

export const PANE_CHROME_SIGNAL = "pi.workspace";
export const PANE_CHROME_SCRIPT_FILE = "pane-chrome.js";

export interface PaneChromeWorkspaceSignal {
  readonly activeInstanceId?: string;
  /** 宿主提供了侧栏收起入口时为 true，边车显示收起钮。 */
  readonly canCollapse?: boolean;
  readonly panes: ReadonlyArray<{
    readonly paneId: string;
    readonly title: string;
    readonly icon?: string;
    readonly openCount: number;
    readonly maxInstances: number;
    readonly allowMultiple: boolean;
  }>;
  /**
   * 全工作区实例快照（含 hidden）。各 iframe/webview 边车据此渲染同一组 tabs，
   * 不得各自过滤成「仅本实例」——同步语义依赖这份全集。
   */
  readonly instances: ReadonlyArray<{
    readonly instanceId: string;
    readonly paneId: string;
    readonly state: "open" | "hidden";
    readonly active: boolean;
  }>;
}

/**
 * ui-redesign prototype `.proto-pane-chrome`（轨 + 抬起 chip）+ §4.1 主题 token：
 * - 顶栏 34px / padding 2×4 / gap 3
 * - **唯一** tab|内容分隔：`.pi-c-bar` 底边 1px（每 iframe 边车同构；业务 toolbar 另算）
 * - 轨：surface/background 主面
 * - 选中 tab：surface-subtle chip + `border-left` primary（不用 box-shadow，防 canvas `* {box-shadow:none}`）
 * - 控件半径 4、图标 14、命中 ≥26
 */
const PANE_CHROME_CSS = `
#pi-pane-chrome{--pi-c-h:34px;--pi-c-r:4px;--pi-c-line:hsl(var(--border,0 0% 89%));position:relative;z-index:50;flex:0 0 auto;width:100%;font:12px/1.2 ui-sans-serif,system-ui,"PingFang SC","Microsoft YaHei",sans-serif;color:hsl(var(--foreground,0 0% 9%))}
/* 底边是 tab 区与内容区的契约分隔，所有 pane 同源；勿用 box-shadow 代替（易被业务 * 清掉） */
#pi-pane-chrome .pi-c-bar{display:flex;align-items:center;gap:3px;box-sizing:border-box;min-height:var(--pi-c-h);padding:2px 4px;border:0;border-bottom:1px solid var(--pi-c-line);background:hsl(var(--surface,var(--background,0 0% 100%)))}
#pi-pane-chrome .pi-c-tabs{display:flex;align-items:center;gap:4px;flex:1;min-width:0;overflow:hidden}
/* 最小宽度保证标题可见；放不下的进「更多」，勿压成纯图标 */
#pi-pane-chrome .pi-c-tab{display:inline-flex;align-items:center;flex:0 0 auto;box-sizing:border-box;min-width:88px;max-width:148px;height:28px;padding:0;border:0;border-left:2px solid transparent;border-radius:var(--pi-c-r);background:transparent;color:hsl(var(--muted-foreground,0 0% 45%));font:inherit;line-height:1.2;white-space:nowrap;cursor:pointer;transition:background 160ms ease,color 160ms ease,border-color 160ms ease}
#pi-pane-chrome .pi-c-tab[aria-selected=true]{background:hsl(var(--surface-subtle,var(--muted,0 0% 96.5%)));color:hsl(var(--foreground,0 0% 9%));border-left-color:hsl(var(--primary,0 0% 9%))}
#pi-pane-chrome .pi-c-tab:hover{background:hsl(var(--accent,0 0% 94.9%));color:hsl(var(--foreground,0 0% 9%))}
#pi-pane-chrome .pi-c-tab[aria-selected=true]:hover{background:hsl(var(--surface-subtle,var(--muted,0 0% 96.5%)));color:hsl(var(--foreground,0 0% 9%))}
#pi-pane-chrome .pi-c-tab .pi-c-main{display:inline-flex;align-items:center;gap:5px;min-width:0;flex:1;min-height:28px;padding:4px 2px 4px 6px;border:none;background:transparent;color:inherit;font:inherit;cursor:pointer}
#pi-pane-chrome .pi-c-tab[aria-selected=true] .pi-c-main{font-weight:500}
#pi-pane-chrome .pi-c-tab .pi-c-ic{display:inline-grid;place-items:center;flex:none;opacity:.8;width:14px;height:14px}
#pi-pane-chrome .pi-c-tab[aria-selected=true] .pi-c-ic{opacity:1}
#pi-pane-chrome .pi-c-tab .pi-c-ic svg{display:block;width:14px;height:14px}
#pi-pane-chrome .pi-c-tab .pi-c-t{min-width:2.5em;overflow:hidden;text-overflow:ellipsis}
#pi-pane-chrome .pi-c-tab .pi-c-x{display:inline-grid;place-items:center;flex:none;width:22px;height:100%;padding:2px 5px;border:none;border-radius:var(--pi-c-r);background:transparent;color:hsl(var(--muted-foreground,0 0% 45%));cursor:pointer}
#pi-pane-chrome .pi-c-tab .pi-c-x:hover{color:hsl(var(--foreground,0 0% 9%));background:hsl(var(--surface,var(--background,0 0% 100%)))}
#pi-pane-chrome .pi-c-actions{display:flex;align-items:center;gap:2px;flex:none}
#pi-pane-chrome .pi-c-btn{display:grid;place-items:center;width:26px;height:28px;padding:0;border:none;border-radius:var(--pi-c-r);background:transparent;color:hsl(var(--foreground,0 0% 9%) / .72);cursor:pointer}
#pi-pane-chrome .pi-c-btn:hover{background:hsl(var(--surface-subtle,var(--muted,0 0% 96.5%)));color:hsl(var(--foreground,0 0% 9%))}
#pi-pane-chrome .pi-c-btn[disabled]{opacity:.4;cursor:default}
#pi-pane-chrome .pi-c-btn svg{display:block;width:14px;height:14px}
/* display:grid 会压过 UA 的 [hidden]{display:none}，必须显式盖住 */
#pi-pane-chrome [hidden]{display:none!important}
#pi-pane-chrome .pi-c-menu{position:absolute;top:calc(var(--pi-c-h) + 4px);right:6px;z-index:60;min-width:190px;max-height:min(320px,60vh);overflow:auto;padding:4px;border:1px solid var(--pi-c-line);border-radius:10px;background:hsl(var(--popover,var(--background,0 0% 100%)));box-shadow:0 12px 28px rgb(0 0 0 / .12)}
#pi-pane-chrome .pi-c-item{display:flex;align-items:center;gap:7px;box-sizing:border-box;width:100%;padding:7px 9px;border:0;border-left:2px solid transparent;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer}
#pi-pane-chrome .pi-c-item:hover{background:hsl(var(--surface-subtle,var(--muted,0 0% 96.5%)))}
#pi-pane-chrome .pi-c-item[disabled]{opacity:.45;cursor:default}
#pi-pane-chrome .pi-c-item[aria-current=true]{background:hsl(var(--surface-subtle,var(--muted,0 0% 96.5%)));font-weight:500;border-left-color:hsl(var(--primary,0 0% 9%))}
#pi-pane-chrome .pi-c-title{padding:5px 8px;color:hsl(var(--muted-foreground,0 0% 45%));font-size:11px;font-weight:600;letter-spacing:.04em}
html.pi-pane-chrome-host,html.pi-pane-chrome-host body{height:100%;margin:0}
html.pi-pane-chrome-host body{display:flex;flex-direction:column;min-height:0;background:hsl(var(--background,0 0% 100%))}
/* #root 与无 root 文档（如 logs 的 header/controls/list）均可占满 chrome 下方 */
html.pi-pane-chrome-host body>#root,
html.pi-pane-chrome-host body>#list{flex:1 1 auto;min-height:0;height:auto!important}
`;

export function paneChromeScriptSource(): string {
  // 注意：本脚本作为字符串注入，保持 IIFE、勿用外层 TS 语法。
  // CSS 用 JSON.stringify 内嵌，避免 boot/init 路径 template 转义丢样式（竖排无样式根因）。
  const cssLiteral = JSON.stringify(PANE_CHROME_CSS);
  return `(function(){
  if (window.__PI_PANE_CHROME__) return;
  window.__PI_PANE_CHROME__ = true;
  var CSS_TEXT=${cssLiteral};
  var port=null,seq=0,state=null,root=null,tabsEl=null,menuEl=null,menuMode=null,collapseEl=null,moreEl=null;
  var overflowList=[]; // 宽度放不下但仍 open 的实例
  var TAB_MIN=96;
  var onPortMessage=null;
  var lastLayoutWidth=-1;
  var layoutRaf=0;
  function ensureChromeStyle(){
    try{
      var old=document.querySelectorAll('style[data-pi-pane-chrome]');
      for(var i=0;i<old.length;i++)old[i].parentNode&&old[i].parentNode.removeChild(old[i]);
      var st=document.createElement('style');
      st.setAttribute('data-pi-pane-chrome','');
      st.textContent=CSS_TEXT;
      (document.head||document.documentElement).appendChild(st);
    }catch(_){}
  }
  function svg(pathD, size){
    size=size||14;
    var ns='http://www.w3.org/2000/svg';
    var s=document.createElementNS(ns,'svg');
    s.setAttribute('viewBox','0 0 24 24');
    s.setAttribute('width',String(size));
    s.setAttribute('height',String(size));
    s.setAttribute('fill','none');
    s.setAttribute('stroke','currentColor');
    s.setAttribute('stroke-width','1.8');
    s.setAttribute('stroke-linecap','round');
    s.setAttribute('stroke-linejoin','round');
    s.setAttribute('aria-hidden','true');
    var p=document.createElementNS(ns,'path');
    p.setAttribute('d',pathD);
    s.appendChild(p);
    return s;
  }
  /* h.01 圆点在 14px + stroke 1.8 下几乎不可见；改实心圆与 +/-/刷新同色同权 */
  function svgMore(size){
    size=size||14;
    var ns='http://www.w3.org/2000/svg';
    var s=document.createElementNS(ns,'svg');
    s.setAttribute('viewBox','0 0 24 24');
    s.setAttribute('width',String(size));
    s.setAttribute('height',String(size));
    s.setAttribute('fill','currentColor');
    s.setAttribute('stroke','none');
    s.setAttribute('aria-hidden','true');
    var xs=[6,12,18];
    for(var i=0;i<xs.length;i++){
      var c=document.createElementNS(ns,'circle');
      c.setAttribute('cx',String(xs[i]));
      c.setAttribute('cy','12');
      c.setAttribute('r','1.75');
      s.appendChild(c);
    }
    return s;
  }
  var ICON={
    box:'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z M3.3 7 12 12l8.7-5 M12 22V12',
    files:'M20 7h-3a2 2 0 0 1-2-2V2 M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z M3 7.5V18a2 2 0 0 0 2 2h9',
    'git-compare':'M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M13 6h3a2 2 0 0 1 2 2v7 M11 18H8a2 2 0 0 1-2-2V9',
    images:'M18 22H4a2 2 0 0 1-2-2V6 M22 14V4a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12 M10 8h.01 M14 14l-2-2-4 4',
    palette:'M12 22a1 1 0 0 1 0-20 10 10 0 0 1 10 10 4 4 0 0 1-5 3.9H14a2 2 0 0 0-1 3.75A1 1 0 0 1 12 22Z M13.5 6.5h.01 M17.5 10.5h.01 M6.5 12.5h.01 M8.5 7.5h.01',
    search:'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M21 21l-4.3-4.3',
    'scroll-text':'M15 12h-5 M15 8h-5 M19 17V5a2 2 0 0 0-2-2H4 M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3',
    'square-pen':'M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.4 2.6a2.17 2.17 0 0 1 3 3L12 15l-4 1 1-4Z',
    materials:'M18 22H4a2 2 0 0 1-2-2V6 M22 14V4a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12 M10 8h.01 M14 14l-2-2-4 4',
    canvas:'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
    video:'M15 10l4.55-2.27A1 1 0 0 1 21 8.64v6.72a1 1 0 0 1-1.45.91L15 14 M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
    clapperboard:'M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z M6.2 5.3l3.1 3.9 M12.4 3.4l3.1 4 M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
    logs:'M15 12h-5 M15 8h-5 M19 17V5a2 2 0 0 0-2-2H4 M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3',
    session:'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
    plus:'M5 12h14 M12 5v14',
    more:'__more__',
    refresh:'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16 M8 16H3v5',
    collapse:'M3 4h18v16H3z M15 4v16',
    x:'M18 6 6 18 M6 6l12 12'
  };
  function iconEl(name){
    var d=ICON[name]||ICON.box;
    var wrap=document.createElement('span');
    wrap.className='pi-c-ic';
    wrap.appendChild(svg(d,14));
    return wrap;
  }
  function metaOf(paneId){
    if(!state||!state.panes)return null;
    for(var i=0;i<state.panes.length;i++){
      if(state.panes[i].paneId===paneId)return state.panes[i];
    }
    return null;
  }
  function titleOf(inst){
    var meta=metaOf(inst.paneId);
    var base=meta?meta.title:inst.paneId;
    // 同 pane 多实例：仅追加短序号，不塞 instanceId 碎片
    if(meta&&meta.openCount>1&&state&&state.instances){
      var n=0,ord=0;
      for(var i=0;i<state.instances.length;i++){
        if(state.instances[i].paneId!==inst.paneId)continue;
        n++;
        if(state.instances[i].instanceId===inst.instanceId)ord=n;
      }
      if(n>1)return base+' '+ord;
    }
    return base;
  }
  function tabEl(inst){
    var meta=metaOf(inst.paneId);
    var shell=document.createElement('div');
    shell.className='pi-c-tab';
    shell.setAttribute('role','presentation');
    shell.setAttribute('aria-selected',inst.active?'true':'false');
    shell.setAttribute('data-pane-tab-selected',inst.active?'true':'false');
    var main=document.createElement('button');
    main.type='button';
    main.className='pi-c-main';
    main.setAttribute('role','tab');
    main.setAttribute('aria-selected',inst.active?'true':'false');
    main.title=titleOf(inst);
    if(meta&&meta.icon)main.appendChild(iconEl(meta.icon));
    var t=document.createElement('span');
    t.className='pi-c-t';
    t.textContent=titleOf(inst);
    main.appendChild(t);
    main.addEventListener('click',function(e){
      e.preventDefault();
      e.stopPropagation();
      request('workspace.activate',{instanceId:inst.instanceId});
    });
    var x=document.createElement('button');
    x.type='button';
    x.className='pi-c-x';
    x.setAttribute('aria-label','收起');
    x.title='收起到更多（不销毁）';
    x.appendChild(svg(ICON.x,12));
    x.addEventListener('click',function(e){
      e.preventDefault();
      e.stopPropagation();
      // 宿主 park：进「更多」，不 destroy 实例
      request('workspace.close',{instanceId:inst.instanceId});
    });
    shell.append(main,x);
    return shell;
  }
  function openInstances(){
    if(!state||!state.instances)return [];
    return state.instances.filter(function(i){return i.state!=='hidden';});
  }
  function parkedInstances(){
    if(!state||!state.instances)return [];
    return state.instances.filter(function(i){return i.state==='hidden';});
  }
  function splitVisible(open){
    overflowList=[];
    if(!tabsEl||open.length===0)return open.slice();
    var avail=tabsEl.clientWidth||0;
    if(avail<8)avail=240;
    var maxN=Math.max(1,Math.floor(avail/TAB_MIN));
    if(open.length<=maxN)return open.slice();
    // 保证 active 在条上
    var activeId=state&&state.activeInstanceId;
    var visible=[];
    var rest=[];
    open.forEach(function(inst){
      if(inst.instanceId===activeId)visible.push(inst);
      else rest.push(inst);
    });
    // 从左按原序填满剩余槽
    for(var i=0;i<rest.length;i++){
      if(visible.length<maxN)visible.push(rest[i]);
      else overflowList.push(rest[i]);
    }
    // 恢复 workspace 原序
    var order={};
    open.forEach(function(inst,idx){order[inst.instanceId]=idx;});
    visible.sort(function(a,b){return order[a.instanceId]-order[b.instanceId];});
    overflowList.sort(function(a,b){return order[a.instanceId]-order[b.instanceId];});
    return visible;
  }
  function renderTabs(){
    if(!tabsEl)return;
    tabsEl.replaceChildren();
    if(!state||!state.instances)return;
    var visible=splitVisible(openInstances());
    visible.forEach(function(inst){tabsEl.appendChild(tabEl(inst));});
  }
  function fillNewMenu(){
    menuEl.replaceChildren();
    if(!state||!state.panes)return;
    state.panes.forEach(function(pane){
      var b=document.createElement('button');
      b.type='button';
      b.className='pi-c-item';
      if(pane.openCount>=pane.maxInstances)b.disabled=true;
      if(pane.icon)b.appendChild(iconEl(pane.icon));
      var s=document.createElement('span');
      s.style.cssText='flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      s.textContent=pane.title;
      b.appendChild(s);
      b.title=pane.title;
      b.addEventListener('click',function(){
        closeMenu();
        request('workspace.open',{paneId:pane.paneId});
      });
      menuEl.appendChild(b);
    });
  }
  /** 菜单行：仅 icon + 名字 */
  function addInstRow(inst){
    var meta=metaOf(inst.paneId);
    var b=document.createElement('button');
    b.type='button';
    b.className='pi-c-item';
    if(inst.active)b.setAttribute('aria-current','true');
    if(meta&&meta.icon)b.appendChild(iconEl(meta.icon));
    var s=document.createElement('span');
    s.style.cssText='flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    s.textContent=titleOf(inst);
    b.appendChild(s);
    b.title=titleOf(inst);
    b.addEventListener('click',function(){
      closeMenu();
      request('workspace.activate',{instanceId:inst.instanceId});
    });
    menuEl.appendChild(b);
  }
  function fillMoreMenu(){
    menuEl.replaceChildren();
    var overflow=overflowList.slice();
    var parked=parkedInstances();
    if(overflow.length===0&&parked.length===0)return;
    // 溢出 open + 已收起：只列 icon+名字
    overflow.forEach(function(inst){addInstRow(inst);});
    parked.forEach(function(inst){addInstRow(inst);});
  }
  function request(op,payload){
    // 优先用 guest 发布的共享 port（rebind 安全）
    if(!port&&window.__PI_PANE_PORT__)bindPort(window.__PI_PANE_PORT__);
    if(!port){
      try{console.warn('[pi-pane-chrome] port not ready',op);}catch(_){}
      return;
    }
    try{
      port.postMessage(Object.assign({type:'pane:request',requestId:'pi.chrome.'+(++seq),operation:op},payload||{}));
    }catch(err){
      try{console.warn('[pi-pane-chrome] post failed',err);}catch(_){}
      // port 可能已被 close：尝试重绑
      if(window.__PI_PANE_PORT__&&window.__PI_PANE_PORT__!==port){
        bindPort(window.__PI_PANE_PORT__);
        try{
          port.postMessage(Object.assign({type:'pane:request',requestId:'pi.chrome.'+(++seq),operation:op},payload||{}));
        }catch(_){}
      }
    }
  }
  function openNew(){menuMode='new';fillNewMenu();menuEl.hidden=false;}
  function openMore(){menuMode='more';fillMoreMenu();menuEl.hidden=false;}
  function closeMenu(){menuMode=null;menuEl.hidden=true;}
  function renderCollapse(){
    if(!collapseEl)return;
    collapseEl.hidden=!(state&&state.canCollapse);
  }
  function renderMoreBtn(){
    if(!moreEl)return;
    var show=overflowList.length>0||parkedInstances().length>0;
    moreEl.hidden=!show;
    if(!show&&menuMode==='more')closeMenu();
  }
  function render(){
    renderTabs();
    renderCollapse();
    renderMoreBtn();
    if(menuMode==='new')fillNewMenu();
    else if(menuMode==='more')fillMoreMenu();
    if(tabsEl)lastLayoutWidth=tabsEl.clientWidth||0;
  }
  // 仅宽度真变才重排；replaceChildren 会触发 RO，禁止 RO→render 闭环卡死 WebView2
  function scheduleLayout(){
    if(layoutRaf)return;
    layoutRaf=requestAnimationFrame(function(){
      layoutRaf=0;
      if(!tabsEl||!state)return;
      var w=tabsEl.clientWidth||0;
      if(Math.abs(w-lastLayoutWidth)<1)return;
      render();
    });
  }
  function applyWorkspace(value){
    state=value;
    if(state&&state.panes){
      state.panes=state.panes.map(function(p){
        var m=p.maxInstances;
        if(m==null||m===Infinity||!(m>0))m=1e9;
        return Object.assign({},p,{maxInstances:m});
      });
    }
    render();
  }
  var readyTimer=0;
  function resolvePaneId(){
    if(typeof window.__PI_PANE_ID__==='string'&&window.__PI_PANE_ID__)return window.__PI_PANE_ID__;
    try{
      var u=new URL(location.href);
      var q=u.searchParams.get('pi-pane-id');
      if(q)return q;
    }catch(_){}
    return null;
  }
  function announceReady(){
    // 业务 guest 可不握手；chrome 自己发 ready，Host 建连后推 tabs。
    if(port)return;
    var id=resolvePaneId();
    if(!id)return;
    var msg={type:'pane:ready',protocol:1,paneId:id};
    try{if(parent&&parent!==window)parent.postMessage(msg,'*');}catch(_){}
    // native：bootstrap 只收 source===window 的 ready
    try{window.postMessage(msg,'*');}catch(_){}
  }
  function stopReady(){
    if(readyTimer){clearInterval(readyTimer);readyTimer=0;}
  }
  function bindPort(next){
    if(!next)return;
    if(port===next)return;
    if(port&&onPortMessage){
      try{port.removeEventListener('message',onPortMessage);}catch(_){}
    }
    port=next;
    stopReady();
    onPortMessage=function(msg){
      var data=msg.data;
      if(!data)return;
      if(data.type==='pane:signal'&&data.name==='pi.workspace'){
        applyWorkspace(data.value);
      }
    };
    try{port.addEventListener('message',onPortMessage);port.start();}catch(_){}
    // 绑口瞬间若 guest 已有缓存快照，立刻画 tabs（不必等下一轮 host 推送）
    if(window.__PI_WORKSPACE_SIGNAL__)applyWorkspace(window.__PI_WORKSPACE_SIGNAL__);
  }
  function acceptConnected(event){
    var d=event.data;
    if(!d||d.type!=='pane:connected'||!event.ports||!event.ports.length||!d.instance)return false;
    var src=event.source;
    if(src!=null&&src!==parent&&src!==window)return false;
    bindPort(event.ports[0]);
    return true;
  }
  function mkBtn(label,title,path,onClick){
    var b=document.createElement('button');
    b.type='button';
    b.className='pi-c-btn';
    b.setAttribute('aria-label',label);
    b.title=title;
    b.appendChild(path==='__more__'?svgMore(14):svg(path,14));
    b.addEventListener('click',function(e){e.stopPropagation();onClick();});
    return b;
  }
  function build(){
    if(document.getElementById('pi-pane-chrome'))return;
    ensureChromeStyle();
    document.documentElement.classList.add('pi-pane-chrome-host');
    root=document.createElement('div');
    root.id='pi-pane-chrome';
    root.setAttribute('data-panes-chrome','true');
    var bar=document.createElement('div');
    bar.className='pi-c-bar';
    collapseEl=mkBtn('收起 Pane 侧栏','收起 Pane 侧栏',ICON.collapse,function(){
      request('workspace.collapse',{});
    });
    collapseEl.setAttribute('data-pane-sidebar-collapse','true');
    collapseEl.hidden=true;
    bar.appendChild(collapseEl);
    tabsEl=document.createElement('div');
    tabsEl.className='pi-c-tabs';
    tabsEl.setAttribute('role','tablist');
    tabsEl.setAttribute('aria-label','Panes');
    bar.appendChild(tabsEl);
    var actions=document.createElement('div');
    actions.className='pi-c-actions';
    moreEl=mkBtn('更多','更多',ICON.more,openMore);
    moreEl.setAttribute('data-pane-chrome-more','true');
    moreEl.hidden=true;
    actions.appendChild(moreEl);
    actions.appendChild(mkBtn('新开','新开',ICON.plus,openNew));
    actions.appendChild(mkBtn('刷新','刷新',ICON.refresh,function(){
      var id=state&&state.activeInstanceId;
      if(id)request('workspace.reload',{instanceId:id});
      else request('workspace.reload',{});
    }));
    bar.appendChild(actions);
    menuEl=document.createElement('div');
    menuEl.className='pi-c-menu';
    menuEl.hidden=true;
    root.append(bar,menuEl);
    var body=document.body;
    if(body&&body.firstChild)body.insertBefore(root,body.firstChild);
    else if(body)body.appendChild(root);
    window.addEventListener('mousedown',function(e){
      if(menuEl.hidden)return;
      if(!root.contains(e.target))closeMenu();
    });
    window.addEventListener('resize',scheduleLayout);
    if(window.ResizeObserver&&tabsEl){
      try{new ResizeObserver(scheduleLayout).observe(tabsEl);}catch(_){}
    }
    render();
  }
  // 优先 guest 发布的共享 port
  window.addEventListener('pi-pane-port',function(ev){
    var p=ev&&ev.detail&&ev.detail.port;
    if(p)bindPort(p);
  });
  if(window.__PI_PANE_PORT__)bindPort(window.__PI_PANE_PORT__);
  // guest 已缓存的 workspace 快照（首包可能早于 chrome 监听）
  window.addEventListener('pi-workspace',function(ev){
    if(ev&&ev.detail)applyWorkspace(ev.detail);
  });
  if(window.__PI_WORKSPACE_SIGNAL__)applyWorkspace(window.__PI_WORKSPACE_SIGNAL__);
  window.addEventListener('message',function(event){acceptConnected(event);});
  if(document.body){build();}
  else{document.addEventListener('DOMContentLoaded',build);}
  // 无 guest 的 pane（如 host:browser）也靠 chrome 完成握手拿 tabs
  announceReady();
  readyTimer=setInterval(announceReady,250);
})();`;
}

function paneChromeStyleTag(): string {
  return `<style data-pi-pane-chrome>${PANE_CHROME_CSS}</style>`;
}

function alreadyInjected(documentHtml: string): boolean {
  return (
    documentHtml.includes('id="pi-pane-chrome"') ||
    documentHtml.includes("data-pi-pane-chrome") ||
    documentHtml.includes("pi-pane-chrome-host") ||
    documentHtml.includes(PANE_CHROME_SCRIPT_FILE)
  );
}

/** 剥掉旧 chrome，保证 Host 入口永远装**当前**边车（含握手/状态同步）。 */
export function stripPaneChrome(documentHtml: string): string {
  return documentHtml
    .replace(/<style\b[^>]*\bdata-pi-pane-chrome\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*\bdata-pi-pane-chrome\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\bdata-pi-pane-id\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\sclass=(["'])pi-pane-chrome-host\1/gi, "");
}

function insertBeforeBodyClose(documentHtml: string, injection: string): string {
  const idx = documentHtml.toLowerCase().lastIndexOf("</body>");
  if (idx !== -1) {
    return `${documentHtml.slice(0, idx)}${injection}${documentHtml.slice(idx)}`;
  }
  const close = documentHtml.toLowerCase().lastIndexOf("</html>");
  if (close !== -1) {
    return `${documentHtml.slice(0, close)}${injection}${documentHtml.slice(close)}`;
  }
  return documentHtml + injection;
}

function paneIdBootTag(paneId: string | undefined): string {
  if (paneId === undefined || paneId.length === 0) return "";
  const assign = `window.__PI_PANE_ID__=${JSON.stringify(paneId)};`;
  return `<script data-pi-pane-id>${assign.replace(/<\/script/gi, "<\\/script")}</script>`;
}

export function injectPaneChromeHtml(
  documentHtml: string,
  options: { readonly paneId?: string; readonly force?: boolean } = {},
): string {
  const base = options.force === true ? stripPaneChrome(documentHtml) : documentHtml;
  if (options.force !== true && alreadyInjected(base)) {
    // 旧包装可能无 paneId / 旧脚本；force 路径由 Host 使用。
    return base;
  }
  const script = paneChromeScriptSource().replace(/<\/script/gi, "<\\/script");
  return insertBeforeBodyClose(
    base,
    `${paneIdBootTag(options.paneId)}${paneChromeStyleTag()}<script data-pi-pane-chrome>${script}</script>`,
  );
}

export function injectPaneChromeExternal(
  documentHtml: string,
  scriptSrc: string = `./${PANE_CHROME_SCRIPT_FILE}`,
  options: { readonly paneId?: string; readonly force?: boolean } = {},
): string {
  const base = options.force === true ? stripPaneChrome(documentHtml) : documentHtml;
  if (options.force !== true && alreadyInjected(base)) return base;
  const safeSrc = scriptSrc.replace(/"/g, "&quot;");
  return insertBeforeBodyClose(
    base,
    `${paneIdBootTag(options.paneId)}${paneChromeStyleTag()}<script data-pi-pane-chrome src="${safeSrc}"></script>`,
  );
}

export type WrapPaneDocumentMode = "inline" | "external";

export interface WrapPaneDocumentOptions {
  /**
   * `inline`：脚本内联（srcDoc / CSP unsafe-inline）。
   * `external`：引用同目录 `pane-chrome.js`（URL / Tauri native；调用方须落盘脚本）。
   */
  readonly mode?: WrapPaneDocumentMode;
  /** external 形态的脚本 URL，默认 `./pane-chrome.js`。 */
  readonly scriptSrc?: string;
  /** 写入 `__PI_PANE_ID__`，供 chrome 自行 pane:ready 握手。 */
  readonly paneId?: string;
  /**
   * 剥掉旧 chrome 再注入。Host 入口默认 true，避免构建期旧边车挡住握手逻辑。
   */
  readonly force?: boolean;
}

/**
 * **默认 pane 文档包装器**：给任意 pane HTML 装上跨 realm 同步的 tabs 头。
 *
 * Host 入口应走 `withDefaultPaneChrome`；构建期 URL 资产可用 external 模式。
 */
export function wrapPaneDocument(
  documentHtml: string,
  options: WrapPaneDocumentOptions = {},
): string {
  const mode = options.mode ?? "inline";
  if (mode === "external") {
    return injectPaneChromeExternal(documentHtml, options.scriptSrc, {
      paneId: options.paneId,
      force: options.force,
    });
  }
  return injectPaneChromeHtml(documentHtml, {
    paneId: options.paneId,
    force: options.force,
  });
}

/**
 * **底层 boot 脚本**（Tauri `initialization_script`）。
 * 与 HTML 是否预 wrap 无关；`__PI_PANE_CHROME__` 幂等。
 * paneId 也可经 URL `?pi-pane-id=`（warm 池 navigate 复用时 init 脚本不改写）。
 */
export function paneChromeBootScript(paneId?: string): string {
  // 样式已内嵌在 paneChromeScriptSource().ensureChromeStyle；boot 只负责 paneId + 跑边车。
  const idBoot =
    paneId !== undefined && paneId.length > 0
      ? `try{window.__PI_PANE_ID__=${JSON.stringify(paneId)};}catch(_){}`
      : "";
  return `(function(){
  ${idBoot}
  ${paneChromeScriptSource()}
})();`;
}

/**
 * **PanesHost 唯一包装入口**：全部 inline 文档强制装当前 chrome + paneId 握手。
 * URL 形态：native 用 boot；浏览器 iframe URL 仍靠资产 wrap 或改 inline。
 */
export function withDefaultPaneChrome(definition: PanesDefinition): PanesDefinition {
  let changed = false;
  const panes = definition.panes.map((pane) => {
    const nextDoc = wrapPaneDocumentForHost(pane.document, pane.id);
    if (nextDoc === pane.document) return pane;
    changed = true;
    return { ...pane, document: nextDoc } satisfies PaneDefinition;
  });
  return changed ? { ...definition, panes } : definition;
}

/**
 * 单文档 Host 包装：剥旧 chrome → 注入最新边车 + paneId。
 * html URL 原样返回（native boot / 资产侧负责）。
 */
export function wrapPaneDocumentForHost(
  document: PaneDocument,
  paneId: string,
): PaneDocument {
  if (document.kind !== "inline") return document;
  const srcDoc = wrapPaneDocument(document.srcDoc, {
    mode: "inline",
    paneId,
    force: true,
  });
  if (srcDoc === document.srcDoc) return document;
  return { kind: "inline", srcDoc };
}
