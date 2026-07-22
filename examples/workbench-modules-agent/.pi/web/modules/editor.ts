import { createGuestDocument } from "../guest-document.js";
import type { WorkbenchModule } from "../workbench-types.js";

export const editorModule: WorkbenchModule = {
  id: "editor",
  title: "编辑器",
  icon: "⌘",
  capabilities: { write: true },
  document: createGuestDocument(
    "代码编辑器",
    `<div class="bar"><strong>代码编辑器</strong><select id="files" class="grow"></select><span id="rev" class="muted"></span><button id="save">保存</button></div>
     <textarea id="content" spellcheck="false"></textarea><div id="status" class="muted"></div>`,
    `
let revision=0,current='';const select=document.querySelector('#files'),content=document.querySelector('#content'),status=document.querySelector('#status');
async function load(path){try{const r=await workbench.request('query',path?{path}:{});revision=r.revision;current=r.file?.path||'';select.innerHTML=r.files.map(p=>'<option '+(p===current?'selected':'')+'>'+p+'</option>').join('');content.value=r.file?.content||'';document.querySelector('#rev').textContent='rev '+revision;status.textContent='已同步';status.className='muted'}catch(e){status.textContent=e.message;status.className='error'}}
select.addEventListener('change',()=>load(select.value));document.querySelector('#save').addEventListener('click',async()=>{try{const r=await workbench.request('mutate',{operation:'write-file',expectedRevision:revision,payload:{path:current,content:content.value}});revision=r.revision;document.querySelector('#rev').textContent='rev '+revision;status.textContent='已保存';status.className='ok'}catch(e){status.textContent=e.message+'，请重新载入';status.className='error'}});
window.addEventListener('workbench:connected',()=>load());workbench.onSnapshot(s=>{if(s.revision!==revision){status.textContent='工作区已有新修订，保存前请切换文件重新载入';status.className='error'}});
`,
  ),
};
