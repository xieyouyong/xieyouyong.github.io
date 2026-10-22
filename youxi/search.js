import { apiRequest } from './connection.js?v=4';
// The visitor supplies an access password; API keys remain in the Worker.
export async function planQuestion(question,history,credential,signal) {
  const fallback={localQueries:[question]};
  const control=new AbortController();
  const abort=()=>control.abort(signal.reason);signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted)abort();
  const timer=setTimeout(()=>control.abort(),18000);
  try {
    const response=await apiRequest('/plan',credential,{question,recent_questions:history.filter(m=>m.role==='user').slice(-2).map(m=>m.content)},control.signal);
    if(!response.ok)return fallback;
    const payload=await response.json();const data=JSON.parse(payload.choices?.[0]?.message?.content||'{}');
    const clean=(value,limit)=>Array.isArray(value)?value.filter(v=>typeof v==='string'&&v.trim()).slice(0,limit).map(v=>v.trim().slice(0,250)):[];
    const local=clean(data.local_queries,4);
    return {localQueries:local.length?local:[question]};
  }catch{return fallback;}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
