import { createGuestDocument } from "../guest-document.js";
import type { WorkbenchModule } from "../workbench-types.js";

export const canvasModule: WorkbenchModule = {
  id: "canvas",
  title: "Canvas",
  icon: "◈",
  capabilities: { write: true, attachments: true },
  document: createGuestDocument(
    "Canvas",
    `<div class="bar"><strong>Canvas</strong><span id="rev" class="muted grow"></span><input id="asset" type="file" accept="image/*"><button id="clear">清空</button></div>
     <svg id="stage" viewBox="0 0 640 360" style="width:100%;height:calc(100vh - 130px);border:1px solid #334155;border-radius:12px;background:#0f172a"></svg>
     <div id="assets" class="muted"></div><div id="status" class="muted">点击画布添加图形</div>`,
    `
let revision=0;const stage=document.querySelector('#stage'),status=document.querySelector('#status'),assets=document.querySelector('#assets');
async function load(){try{const r=await workbench.request('query',{});revision=r.revision;document.querySelector('#rev').textContent='rev '+revision;stage.innerHTML=r.shapes.map(s=>'<circle cx="'+s.x+'" cy="'+s.y+'" r="18" fill="'+s.color+'"/>').join('');assets.textContent=r.attachments.length?r.attachments.map(a=>a.name+' ('+a.attachmentId+')').join(' · '):'暂无附件引用'}catch(e){status.textContent=e.message;status.className='error'}}
stage.addEventListener('click',async(e)=>{const rect=stage.getBoundingClientRect(),x=(e.clientX-rect.left)*640/rect.width,y=(e.clientY-rect.top)*360/rect.height;try{await workbench.request('mutate',{operation:'add-shape',expectedRevision:revision,payload:{x,y,color:['#38bdf8','#a78bfa','#34d399'][revision%3]}});await load()}catch(err){status.textContent=err.message;status.className='error'}});
document.querySelector('#clear').addEventListener('click',async()=>{try{await workbench.request('mutate',{operation:'clear-canvas',expectedRevision:revision,payload:{}});await load()}catch(e){status.textContent=e.message;status.className='error'}});
document.querySelector('#asset').addEventListener('change',async(e)=>{const file=e.target.files?.[0];if(!file)return;try{const bytes=await file.arrayBuffer();const uploaded=await workbench.request('attach',{name:file.name,type:file.type,bytes},[bytes]);await workbench.request('mutate',{operation:'link-attachment',expectedRevision:revision,payload:{attachmentId:uploaded.attachmentId,name:file.name}});await load();status.textContent='附件已落库，仅引用进入模块状态';status.className='ok'}catch(err){status.textContent=err.message;status.className='error'}e.target.value=''});
window.addEventListener('workbench:connected',load);workbench.onSnapshot(s=>{if(s.revision!==revision)load()});
`,
  ),
};
