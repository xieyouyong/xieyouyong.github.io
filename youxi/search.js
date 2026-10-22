import { modelRequest } from './connection.js?v=5';
// Shared access uses the Worker; personal API keys call DeepSeek directly.
export async function planQuestion(question,history,connection,signal) {
  const fallback={localQueries:[question]};
  const control=new AbortController();
  const abort=()=>control.abort(signal.reason);signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted)abort();
  const timer=setTimeout(()=>control.abort(),18000);
  try {
    const response=await modelRequest('/plan',connection,{question,recent_questions:history.filter(m=>m.role==='user').slice(-2).map(m=>m.content)},control.signal);
    if(!response.ok)return fallback;
    const payload=await response.json();const data=JSON.parse(payload.choices?.[0]?.message?.content||'{}');
    const clean=(value,limit)=>Array.isArray(value)?value.filter(v=>typeof v==='string'&&v.trim()).slice(0,limit).map(v=>v.trim().slice(0,250)):[];
    const local=clean(data.local_queries,4);
    return {localQueries:local.length?local:[question]};
  }catch{return fallback;}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}

export async function searchWeb(queries,key,signal) {
  const control=new AbortController();const abort=()=>control.abort(signal.reason);
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const timer=setTimeout(()=>control.abort(),20000);
  try {
    const results=await Promise.allSettled(queries.slice(0,2).map(async query=>{
      const response=await fetch('https://api.tavily.com/search',{
        method:'POST',signal:control.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
        body:JSON.stringify({query,search_depth:'basic',max_results:3,include_answer:false,include_raw_content:false})
      });
      if(!response.ok)throw new Error('搜索服务未返回结果，请检查搜索密钥或额度。');
      const data=await response.json();if(!Array.isArray(data.results))throw new Error('搜索服务返回格式异常。');
      return data.results.filter(r=>typeof r.content==='string').map(r=>({title:String(r.title||'网络参考').slice(0,200),content:r.content.slice(0,1800),url:String(r.url||'')}));
    }));
    const successes=results.filter(r=>r.status==='fulfilled');
    if(!successes.length)throw new Error('联网搜索失败，将使用本地资料和一般知识推测。');
    const dedup=new Map();for(const r of successes.flatMap(r=>r.value))dedup.set(r.url||r.title,r);
    return {results:[...dedup.values()].slice(0,6),partial:successes.length<results.length};
  }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
