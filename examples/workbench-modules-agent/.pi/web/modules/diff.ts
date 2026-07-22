import { createGuestDocument } from "../guest-document.js";
import type { WorkbenchModule } from "../workbench-types.js";

export const diffModule: WorkbenchModule = {
  id: "diff",
  title: "Diff",
  icon: "±",
  capabilities: {},
  document: createGuestDocument(
    "Git Diff",
    `<div class="bar"><strong>Git Diff</strong><span id="rev" class="muted grow"></span><button id="reload">刷新</button></div><div id="diffs"></div><div id="status" class="muted"></div>`,
    `
let revision=-1;const diffs=document.querySelector('#diffs'),status=document.querySelector('#status');const esc=s=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function load(){try{const r=await workbench.request('query',{});revision=r.revision;document.querySelector('#rev').textContent='rev '+revision;diffs.innerHTML=r.files.map(f=>'<section class="card"><strong>'+f.path+'</strong><pre><span class="error">--- '+esc(f.before)+'</span>\n<span class="ok">+++ '+esc(f.after)+'</span></pre></section>').join('')||'<div class="muted">工作区无改动</div>';status.textContent=''}catch(e){status.textContent=e.message;status.className='error'}}
document.querySelector('#reload').addEventListener('click',load);window.addEventListener('workbench:connected',load);workbench.onSnapshot(s=>{if(s.revision!==revision)load()});
`,
  ),
};
