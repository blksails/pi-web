#!/bin/sh
# 测试夹具 entrypoint(模拟 pi-clouds 未来的「网关模板分支」):
# 见 PI_LLM_GATEWAY_BASE 即把 models.json 每个 provider 改成网关形态
# (baseUrl=$PI_LLM_GATEWAY_BASE/<id>, apiKey=$PI_LLM_TOKEN_<ID>, authHeader:true),
# 真实上游 key 全程不进本容器。缺网关 env 时回退原直连注入逻辑(保底)。
set -e
mkdir -p /root/.pi/agent
if [ -n "$PI_LLM_GATEWAY_BASE" ]; then
  echo "[entrypoint-gw] LLM 网关模式 base=$PI_LLM_GATEWAY_BASE"
  node -e '
    const fs=require("fs");
    const p="/root/.pi/agent/models.json";
    const c=JSON.parse(fs.readFileSync(p,"utf8"));
    const base=process.env.PI_LLM_GATEWAY_BASE;
    for(const [id,prov] of Object.entries(c.providers)){
      const tokEnv="PI_LLM_TOKEN_"+id.toUpperCase().replace(/-/g,"_");
      const tok=process.env[tokEnv]||"";
      if(!tok){console.error("[entrypoint-gw] WARN "+tokEnv+" 未注入");}
      prov.baseUrl=base+"/"+id;
      prov.apiKey=tok;
      prov.authHeader=true;
      console.log("[entrypoint-gw] "+id+" → "+prov.baseUrl+" token="+tok.slice(0,24)+"…");
    }
    fs.writeFileSync(p,JSON.stringify(c));
  '
else
  echo "[entrypoint-gw] 无网关 env,回退直连注入"
  node -e '
    const fs=require("fs");const p="/root/.pi/agent/models.json";
    const c=JSON.parse(fs.readFileSync(p,"utf8"));
    const inj=(pr,e)=>{if(c.providers[pr])c.providers[pr].apiKey=process.env[e]||"";};
    inj("dashscope","DASHSCOPE_API_KEY");inj("apiservices","APISERVICES_API_KEY");
    fs.writeFileSync(p,JSON.stringify(c));
  '
fi
exec node /app/runner.js
