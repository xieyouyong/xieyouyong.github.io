import { bindModelDialog } from '../assets/model-dialog.js?v=1';
import { createRetriever, buildMessages, setAnswerPrompt } from './rag.js?v=6';
import { planQuestion, searchWeb } from './search.js?v=5';
import { apiRequest, modelRequest } from './connection.js?v=5';
const $ = id => document.getElementById(id);
let retrieve, connection=null, controller=null, pendingQuestion='', history=[];
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function hideReferences(s) { return s.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g,'$1').replace(/\[\d{1,2}\]/g,'').replace(/https?:\/\/[^\s<>]+/g,''); }
function inline(s) { return escape(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>'); }
// Only escaped text and a small, fixed Markdown subset enter the DOM.
function markdown(text) {
  const lines=text.split(/\r?\n/); let html='', inCode=false, code=[], table=[];
  const flushTable=()=>{
    if(!table.length)return;
    const rows=table.filter(l=>!/^\s*\|?[\s:|-]+\|?\s*$/.test(l)).map(l=>l.trim().replace(/^\||\|$/g,'').split('|'));
    html+='<div class="table-wrap"><table>'+rows.map((r,i)=>'<tr>'+r.map(c=>`<${i?'td':'th'}>${inline(c.trim())}</${i?'td':'th'}>`).join('')+'</tr>').join('')+'</table></div>';table=[];
  };
  for(const line of lines) {
    if(/^\s*```/.test(line)) { flushTable(); if(inCode){html+='<pre>'+escape(code.join('\n'))+'</pre>';code=[];} inCode=!inCode; continue; }
    if(inCode){code.push(line);continue;}
    if(/^\s*\|/.test(line)){table.push(line);continue;}flushTable();
    if(!line.trim())continue;
    if(/^#{1,6}\s/.test(line)){html+='<h3>'+inline(line.replace(/^#{1,6}\s+/,''))+'</h3>';continue;}
    html+='<p>'+inline(line.replace(/^>\s?/,''))+'</p>';
  }
  flushTable();if(inCode)html+='<pre>'+escape(code.join('\n'))+'</pre>';return html;
}
function addMessage(role,text='') {
  const el=document.createElement('article');el.className=`message ${role}`;
  const label=document.createElement('div');label.className='message-label';label.textContent=role==='user'?'你的问题':'最尾厝问问';
  const body=document.createElement('div');body.className='message-body';body.textContent=text;
  el.append(label,body);$('messages').append(el);return {el,body};
}
function busy(on){$('send').classList.toggle('hidden',on);$('stop').classList.toggle('hidden',!on);$('question').disabled=on;$('send').disabled=on||!retrieve;$('settings-open').disabled=on;document.querySelectorAll('[data-question]').forEach(b=>b.disabled=on);}
const settings = bindModelDialog({
  async authenticate(candidate, signal) {
    const response = candidate.mode === 'shared'
      ? await apiRequest('/auth', candidate.credential, {}, signal)
      : await modelRequest('/plan', candidate, {question:'连接测试'}, signal);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || data.error || '连接失败，请检查密钥和模型名称。');
    }
    await response.body?.cancel();
  },
  onConnection(value) {
    connection = value;
    if (retrieve) $('status').textContent = value
      ? (value.mode === 'shared' ? '已连接最尾厝密钥' : '已配置自己的 API 密钥')
      : '资料已就绪 · 可使用最尾厝密钥或自己的 API 密钥';
  },
  onLogin() {
    if (pendingQuestion) {const question=pendingQuestion;pendingQuestion='';ask(question);}
  },
});
$('settings').addEventListener('close',()=>{pendingQuestion='';});
$('stop').onclick=()=>controller?.abort();
$('question-form').onsubmit=e=>{e.preventDefault();ask($('question').value.trim());};
$('question').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!$('send').disabled) $('question-form').requestSubmit();}};
document.querySelectorAll('[data-question]').forEach(b=>b.onclick=()=>{if(!retrieve)return;$('question').value=b.dataset.question;ask(b.dataset.question);});
async function ask(question) {
  if(!question||controller||!retrieve)return;
  if(question.length>1200){$('status').textContent='请把问题缩短到1200字以内。';return;}
  if(!connection){pendingQuestion=question;settings.open();return;}
  $('welcome').classList.add('hidden');$('question').value='';busy(true);addMessage('user',question);
  const lastQuestion=history.filter(m=>m.role==='user').at(-1)?.content||'';
  const isFollowup=/^(那|它|这个|那个|还有|为什么|举例|继续)/.test(question);
  const answer=addMessage('assistant');answer.el.scrollIntoView({behavior:'smooth',block:'start'});
  controller=new AbortController();const timer=setTimeout(()=>controller?.abort('timeout'),210000);
  let text='', complete=false, searchState='未联网';
  answer.body.classList.add('streaming');answer.body.textContent='正在查询最尾厝书房';$('status').textContent='正在查询最尾厝书房';
  try{
    const plan=await planQuestion(question,history,connection,controller.signal);
    if(controller.signal.aborted)throw new Error('已停止');
    const queries=[question+(isFollowup?' '+lastQuestion:''),...plan.localQueries];
    const ranked=new Map();
    for(const q of queries)for(const hit of retrieve(q)){
      const previous=ranked.get(hit.id);
      if(!previous||hit.score>previous.score)ranked.set(hit.id,hit);
    }
    const hits=[...ranked.values()].sort((a,b)=>b.score-a.score).slice(0,8);
    let webResults=[];
    searchState='本次未联网；使用本地资料与一般知识回答';
    if(connection.searchKey&&(!hits.length||/对比|比较|区别|不同|普通话|闽南|闽北|闽东|福州|厦门|泉州|搜索|上网|联网|最新/.test(question))){
      $('status').textContent='正在查询最尾厝书房';
      try{
        const found=await searchWeb([question],connection.searchKey,controller.signal);webResults=found.results;
        searchState=webResults.length?'已取得网络搜索结果':'已执行搜索，但没有相关结果';
      }catch{searchState='联网搜索失败；没有取得网络参考';}
    }
    if(controller.signal.aborted)throw new Error('已停止');
    answer.body.textContent='正在查询最尾厝书房';$('status').textContent='正在查询最尾厝书房';
    const response=await modelRequest('/chat',connection,{messages:buildMessages(question,hits,history,webResults,searchState)},controller.signal);
    if(!response.ok){
      const personal=connection.mode==='personal';
      if(response.status===401){settings.clear();}
      const data=await response.json().catch(()=>({}));
      const reasons={400:'模型名称或参数无效，请检查模型设置。',401:'API 密钥无效，请重新连接。',402:'DeepSeek 账户余额不足。',403:'API 密钥没有调用权限。',429:'请求过于频繁，请稍后重试。'};
      throw new Error((personal?reasons[response.status]:data.error)||`问答服务返回 ${response.status}，请稍后重试。`);
    }
    if(!response.body)throw new Error('浏览器没有收到回答数据，请重试。');
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    const processLine=line=>{
      if(!line.startsWith('data:'))return;
      const data=line.slice(5).trim();if(!data)return;
      if(data==='[DONE]'){complete=true;return;}
      const event=JSON.parse(data);
      if(event.error)throw new Error('模型服务返回错误，请稍后重试。');
      const choice=event.choices?.[0];const piece=choice?.delta?.content;
      if(piece){text+=piece;answer.body.textContent=hideReferences(text);}
      if(choice?.finish_reason==='stop')complete=true;
      if(choice?.finish_reason==='length')throw new Error('回答达到长度限制，尚未完成；请缩小问题范围后重试。');
    };
    while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let idx;
      while((idx=buffer.indexOf('\n'))!==-1){processLine(buffer.slice(0,idx).replace(/\r$/,''));buffer=buffer.slice(idx+1);}
      if(done){if(buffer.trim())processLine(buffer.trim());break;}
    }
    if(!text.trim())throw new Error('模型没有返回回答，请稍后重试。');
    if(!complete)throw new Error('回答连接中断，以下内容可能不完整，请重试。');
    answer.body.classList.remove('streaming');answer.body.innerHTML=markdown(hideReferences(text));
    history.push({role:'user',content:question},{role:'assistant',content:hideReferences(text)});history=history.slice(-6);
    $('status').textContent=searchState+' · 回答已完成';
  }catch(err){
    answer.body.classList.remove('streaming');answer.body.textContent=hideReferences(text);
    const p=document.createElement('p');p.className='message-error';
    p.textContent=controller.signal.aborted?(controller.signal.reason==='timeout'?'等待回答超时，请稍后重试。':'已停止生成；已有内容可能不完整。'):(err instanceof TypeError?'无法连接问答服务，请检查网络后重试。':err.message);
    answer.el.append(p);$('status').textContent='生成未完成 · 请重试';
  }finally{
    clearTimeout(timer);controller=null;busy(false);
    $('question').focus({preventScroll:true});
  }
}
try{
  const [response,promptResponse]=await Promise.all([fetch('./data/corpus.json'),fetch('./answer-prompt.md',{cache:'no-cache'})]);
  if(!response.ok||!promptResponse.ok)throw new Error();
  const corpus=await response.json();setAnswerPrompt(await promptResponse.text());
  if(!Array.isArray(corpus.chunks)||!corpus.chunks.length)throw new Error();retrieve=createRetriever(corpus.chunks);
  $('send').disabled=false;$('status').textContent=connection ? '已恢复模型连接' : '资料已就绪 · 可使用最尾厝密钥或自己的 API 密钥';
}catch{
  $('status').textContent='方言资料或回答规则加载失败，请刷新页面。';$('question').disabled=true;
}
