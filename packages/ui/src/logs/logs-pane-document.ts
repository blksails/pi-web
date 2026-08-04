/**
 * 日志 Guest 文档：零 React、零宿主 DOM 访问。
 *
 * 文档以 data URL 载入：浏览器端是 sandbox iframe，Tauri 端由 PanesHost 载入原生
 * child WebView。日志数据只经 Pane bridge 的 `session.logs` 授权路由取得。
 */

export const LOGS_PANE_ID = "logs";

const LOGS_PANE_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>日志</title><style>
:root{color-scheme:dark;--bg:#111827;--fg:#e5e7eb;--muted:#9ca3af;--line:#374151;--control:#1f2937}
*{box-sizing:border-box}html,body{height:100%;margin:0}body{display:flex;flex-direction:column;background:var(--bg);color:var(--fg);font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}
header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-bottom:1px solid var(--line);flex:none;font-weight:600}
#status{color:var(--muted);font-weight:400;font-size:11px}#controls{display:flex;gap:6px;padding:7px 10px;border-bottom:1px solid var(--line);flex:none}
select,input{min-width:0;height:26px;border:1px solid var(--line);border-radius:4px;background:var(--control);color:var(--fg);padding:3px 6px;font:inherit}select{width:78px}input{flex:1}
#list{list-style:none;overflow:auto;flex:1;margin:0;padding:4px 0}.row{display:flex;gap:7px;align-items:baseline;padding:2px 10px}.row:hover{background:#1f2937}.ts{color:var(--muted);flex:none}.level{width:38px;flex:none;font-weight:700}.ns{max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);flex:none}.msg{min-width:0;overflow-wrap:anywhere}.debug{color:var(--muted)}.info{color:#93c5fd}.warn{color:#fcd34d}.error{color:#fca5a5}
</style></head><body><header><span>日志 <span id="count"></span></span><span id="status">正在连接…</span></header>
<div id="controls"><select id="level" aria-label="最低级别"><option value="debug">debug</option><option value="info">info</option><option value="warn">warn</option><option value="error">error</option></select><input id="namespace" placeholder="命名空间"><input id="search" placeholder="搜索"></div>
<ul id="list" data-pi-logs-region></ul><script>
(function(){
  var port, seq=0, pending=new Map(), entries=new Map(), level=document.getElementById('level'), namespace=document.getElementById('namespace'), search=document.getElementById('search'), list=document.getElementById('list'), count=document.getElementById('count'), status=document.getElementById('status');
  var ranks={debug:0,info:1,warn:2,error:3};
  function paint(){
    var min=ranks[level.value]||0, ns=namespace.value, q=search.value, rows=[];
    entries.forEach(function(e){if(ranks[e.level] < min)return;if(ns && e.ns!==ns && e.ns.indexOf(ns+':')!==0)return;if(q && String(e.msg).indexOf(q)<0)return;rows.push(e);});
    rows.sort(function(a,b){return (a.ts||0)-(b.ts||0)}); list.replaceChildren(); count.textContent=rows.length?'· '+rows.length:'';
    rows.forEach(function(e){var li=document.createElement('li');li.className='row';li.dataset.piLogNs=e.ns||'';li.dataset.piLogLevel=e.level||'debug';var ts=document.createElement('span');ts.className='ts';ts.textContent=new Date(e.ts||0).toLocaleTimeString();var lv=document.createElement('span');lv.className='level '+(e.level||'debug');lv.textContent=String(e.level||'debug').toUpperCase();var n=document.createElement('span');n.className='ns';n.title=e.ns||'';n.textContent=e.ns||'';var m=document.createElement('span');m.className='msg';m.textContent=String(e.msg||'');li.append(ts,lv,n,m);list.append(li);});
  }
  function query(){if(!port)return;var id='logs-'+(++seq);pending.set(id,0);port.postMessage({type:'pane:request',requestId:id,operation:'route.query',route:'session.logs',query:{limit:'500'}});}
  function connect(event){var d=event.data;if(event.source!==parent||!d||d.type!=='pane:connected'||d.protocol!==1||!event.ports||event.ports.length!==1||!d.instance||d.instance.paneId!=='logs')return;port=event.ports[0];port.onmessage=function(message){var data=message.data;if(!data||data.type!=='pane:result')return;pending.delete(data.requestId);if(!data.ok){status.textContent='日志读取失败';return;}var body=data.data, listData=Array.isArray(body)?body:(body&&Array.isArray(body.entries)?body.entries:[]);listData.forEach(function(e){if(e&&typeof e.id==='string')entries.set(e.id,e);});status.textContent='已连接';paint();};port.start&&port.start();query();setInterval(query,1000);}
  window.addEventListener('message',connect); window.parent.postMessage({type:'pane:ready',protocol:1,paneId:'logs'},'*');
  level.addEventListener('change',paint);namespace.addEventListener('input',paint);search.addEventListener('input',paint);
})();</script></body></html>`;

export interface LogsPaneDocument {
  readonly kind: "html";
  readonly src: string;
}

export function createLogsPaneDocument(): LogsPaneDocument {
  return {
    kind: "html",
    src: `data:text/html;charset=utf-8,${encodeURIComponent(LOGS_PANE_HTML)}`,
  };
}
