import { createGuestDocument } from "../guest-document.js";
import type { WorkbenchModule } from "../workbench-types.js";

export const filesModule: WorkbenchModule = {
  id: "files",
  title: "文件",
  icon: "▤",
  capabilities: { write: true },
  document: createGuestDocument(
    "文件管理器",
    `<div class="bar"><strong>文件管理器</strong><span id="rev" class="muted grow"></span></div>
     <form id="create" class="bar"><input id="path" class="grow" placeholder="notes/todo.md" required><button>新建</button></form>
     <div id="list"></div><div id="status" class="muted"></div>`,
    `
let revision=0;const list=document.querySelector('#list'),status=document.querySelector('#status');
async function load(){try{const r=await workbench.request('query',{});revision=r.revision;document.querySelector('#rev').textContent='rev '+revision;list.innerHTML=r.files.map(f=>'<div class="card"><strong>'+f.path+'</strong><span class="muted"> · v'+f.version+'</span></div>').join('')||'<div class="muted">暂无文件</div>';}catch(e){status.textContent=e.message;status.className='error'}}
document.querySelector('#create').addEventListener('submit',async(e)=>{e.preventDefault();status.textContent='';try{await workbench.request('mutate',{operation:'add-file',expectedRevision:revision,payload:{path:document.querySelector('#path').value}});document.querySelector('#path').value='';await load()}catch(err){status.textContent=err.message;status.className='error'}});
window.addEventListener('workbench:connected',load);workbench.onSnapshot(s=>{if(s.revision!==revision)load()});
`,
  ),
};
