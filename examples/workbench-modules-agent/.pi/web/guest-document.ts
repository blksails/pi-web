const BASE_STYLE = `
:root{font:13px/1.5 Inter,ui-sans-serif,system-ui;color:#e5e7eb;background:#0b1020;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;padding:16px}button,input,select,textarea{font:inherit;color:inherit}
button,input,select,textarea{border:1px solid #334155;background:#111827;border-radius:8px;padding:8px 10px}
button{cursor:pointer}button:hover{background:#1e293b}button:disabled{opacity:.5;cursor:not-allowed}
.bar{display:flex;gap:8px;align-items:center;margin-bottom:12px}.grow{flex:1}.muted{color:#94a3b8;font-size:12px}
.card{border:1px solid #1e293b;background:#111827;border-radius:10px;padding:12px;margin:8px 0}
.error{color:#fca5a5}.ok{color:#86efac}pre{white-space:pre-wrap;word-break:break-word;margin:0}
textarea{width:100%;min-height:calc(100vh - 150px);resize:none;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}
`;

const BRIDGE = `
const pending=new Map();let port;let seq=0;const snapshotListeners=[];
window.workbench={
 request(operation,payload,transfer=[]){
  if(!port)return Promise.reject(new Error('host unavailable'));
  const id='req-'+(++seq);port.postMessage({type:'request',id,operation,payload},transfer);
  return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));
 },
 onSnapshot(listener){snapshotListeners.push(listener)}
};
window.addEventListener('message',(event)=>{
 if(event.source!==parent||event.data?.type!=='workbench:connect'||event.ports.length!==1)return;
 port=event.ports[0];port.onmessage=({data})=>{
  if(data?.type==='response'){
   const call=pending.get(data.id);if(!call)return;pending.delete(data.id);
   data.ok?call.resolve(data.data):call.reject(new Error(data.error||'request failed'));
  }else if(data?.type==='snapshot'){snapshotListeners.forEach((listener)=>listener(data.snapshot));}
 };
 port.start();window.dispatchEvent(new Event('workbench:connected'));
},{once:true});
`;

export function createGuestDocument(title: string, markup: string, script: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src blob: data:"><title>${title}</title><style>${BASE_STYLE}</style></head><body>${markup}<script>${BRIDGE}\n${script}</script></body></html>`;
}
