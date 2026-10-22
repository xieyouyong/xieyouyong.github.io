// Public service address only. Never put a model API key or access password here.
const endpoint='https://youxi-rag-api.youyongxie.workers.dev';
export function apiRequest(path,password,body,signal){
  return fetch(endpoint+path,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${password}`},
    body:JSON.stringify(body),signal,credentials:'omit',redirect:'error'
  });
}
