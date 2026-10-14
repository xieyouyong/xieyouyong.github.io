import { createRetriever, buildMessages } from './rag.js';
const $ = id => document.getElementById(id);
let corpus, retrieve, credential='', model='deepseek-flash', controller=null, pendingQuestion='', activeHits=[], history=[];
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function inline(s) { return escape(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\[(\d+)\]/g,'<button type="button" class="citation" data-cite="$1">[$1]</button>'); }
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
function showSource(index,hits) {
  activeHits=hits;showSources(hits);
  const card=$('sources').querySelector(`[data-source="${index}"]`);
  if(card){card.open=true;card.scrollIntoView({behavior:'smooth',block:'nearest'});}
}
function bindCitations(el,hits) {
  el.querySelectorAll('[data-cite]').forEach(btn=>{
    const n=Number(btn.dataset.cite)-1;
    if(!hits[n]){btn.replaceWith(document.createTextNode(btn.textContent));return;}
    btn.setAttribute('aria-label',`查看来源${n+1}`);
    btn.onclick=()=>showSource(n,hits);
  });
}
function showSources(hits) {
  $('sources').replaceChildren();$('source-count').textContent=hits.length?`${hits.length} 个片段`:'0 个片段';
  if(!hits.length){const p=document.createElement('p');p.className='source-empty';p.textContent='当前资料没有匹配片段，请换一个更具体的方言问题。';$('sources').append(p);return;}
  hits.forEach((h,i)=>{
    const card=document.createElement('details');card.className='source-card';card.dataset.source=i;
    const summary=document.createElement('summary');summary.textContent=`[${i+1}] ${h.title}`;
    const meta=document.createElement('small');meta.textContent=`原书第 ${h.pages} 页 · 首轮复核`;
    const body=document.createElement('div');body.className='source-content';body.innerHTML=markdown(h.text);
    // Source excerpts are displayed without model-style citation buttons.
    body.querySelectorAll('.citation').forEach(b=>b.replaceWith(document.createTextNode(b.textContent)));
    if(h.note){const p=document.createElement('p');p.className='message-error';p.textContent='校注：'+h.note;body.append(p);}
    card.append(summary,meta,body);$('sources').append(card);
  });
}
function addMessage(role,text='') {
  const el=document.createElement('article');el.className=`message ${role}`;
  const label=document.createElement('div');label.className='message-label';label.textContent=role==='user'?'你的问题':'尤溪方言 · 资料回答';
  const body=document.createElement('div');body.className='message-body';body.textContent=text;
  el.append(label,body);$('messages').append(el);return {el,body};
}
function busy(on){$('send').classList.toggle('hidden',on);$('stop').classList.toggle('hidden',!on);$('question').disabled=on;$('send').disabled=on||!retrieve;$('settings-open').disabled=on;document.querySelectorAll('[data-question]').forEach(b=>b.disabled=on);}
function openSettings(){ $('api-key').value=credential;$('model').value=model;$('settings').showModal(); }
$('settings-open').onclick=openSettings;
$('settings-close').onclick=()=>{$('settings').close();pendingQuestion='';};
$('settings').addEventListener('cancel',()=>pendingQuestion='');
$('disconnect').onclick=()=>{credential='';$('api-key').value='';$('connection-dot').classList.remove('connected');$('status').textContent='连接已清除。输入 API 密钥后可继续问答。';};
$('settings-form').onsubmit=e=>{
  e.preventDefault();credential=$('api-key').value.trim();model=$('model').value.trim();
  if(!credential||!model)return;
  $('api-key').value='';$('settings').close();$('connection-dot').classList.add('connected');$('status').textContent='已设置连接 · 提交问题时调用模型';
  if(pendingQuestion){const q=pendingQuestion;pendingQuestion='';ask(q);}
};
$('stop').onclick=()=>controller?.abort();
$('question-form').onsubmit=e=>{e.preventDefault();ask($('question').value.trim());};
$('question').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!$('send').disabled) $('question-form').requestSubmit();}};
document.querySelectorAll('[data-question]').forEach(b=>b.onclick=()=>{if(!retrieve)return;$('question').value=b.dataset.question;ask(b.dataset.question);});
async function ask(question) {
  if(!question||controller||!retrieve)return;
  if(question.length>1200){$('status').textContent='请把问题缩短到1200字以内。';return;}
  if(!credential){pendingQuestion=question;openSettings();return;}
  $('welcome').classList.add('hidden');$('question').value='';busy(true);addMessage('user',question);
  const lastQuestion=history.filter(m=>m.role==='user').at(-1)?.content||'';
  const isFollowup=/^(那|它|这个|那个|还有|为什么|举例|继续)/.test(question);
  const hits=retrieve(question+(isFollowup?' '+lastQuestion:''));activeHits=hits;showSources(hits);
  const answer=addMessage('assistant');answer.el.scrollIntoView({behavior:'smooth',block:'start'});
  if(!hits.length){answer.body.textContent='当前收录的资料没有匹配内容，暂时无法据此回答。可以询问城关话的声母、韵母、声调或连读音变。';$('status').textContent='资料未覆盖 · 未调用模型';busy(false);return;}
  controller=new AbortController();const timer=setTimeout(()=>controller?.abort('timeout'),150000);
  let text='', complete=false;
  answer.body.classList.add('streaming');answer.body.textContent='正在根据资料组织回答…';$('status').textContent=`已检索 ${hits.length} 个片段 · 正在生成回答…`;
  try{
    const response=await fetch('https://api.deepseek.com/chat/completions',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${credential}`},signal:controller.signal,
      body:JSON.stringify({model,messages:buildMessages(question,hits,history),stream:true,temperature:.2,max_tokens:2200,thinking:{type:'disabled'}})
    });
    if(!response.ok){const reasons={400:'模型名或请求参数无效，请检查模型设置。',401:'API 密钥无效，请重新连接模型。',402:'DeepSeek 账户余额不足。',403:'该密钥没有调用权限。',429:'请求过于频繁，请稍后重试。'};throw new Error(reasons[response.status]||`模型服务返回 ${response.status}，请稍后重试。`);}
    if(!response.body)throw new Error('浏览器没有收到回答数据，请重试。');
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    const processLine=line=>{
      if(!line.startsWith('data:'))return;
      const data=line.slice(5).trim();if(!data)return;
      if(data==='[DONE]'){complete=true;return;}
      const event=JSON.parse(data);
      if(event.error)throw new Error('模型服务返回错误，请稍后重试。');
      const choice=event.choices?.[0];const piece=choice?.delta?.content;
      if(piece){text+=piece;answer.body.textContent=text;}
      if(choice?.finish_reason==='stop')complete=true;
      if(choice?.finish_reason==='length')throw new Error('回答达到长度限制，尚未完成；请缩小问题范围后重试。');
    };
    while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let idx;
      while((idx=buffer.indexOf('\n'))!==-1){processLine(buffer.slice(0,idx).replace(/\r$/,''));buffer=buffer.slice(idx+1);}
      if(done){if(buffer.trim())processLine(buffer.trim());break;}
    }
    if(!text.trim())throw new Error('模型没有返回回答，请检查模型设置后重试。');
    if(!complete)throw new Error('回答连接中断，以下内容可能不完整，请重试。');
    answer.body.classList.remove('streaming');answer.body.innerHTML=markdown(text);bindCitations(answer.body,hits);
    history.push({role:'user',content:question},{role:'assistant',content:text});history=history.slice(-6);
    $('status').textContent='回答已生成 · 点击来源编号查看原文';
  }catch(err){
    answer.body.classList.remove('streaming');answer.body.textContent=text;
    const p=document.createElement('p');p.className='message-error';
    p.textContent=controller.signal.aborted?(controller.signal.reason==='timeout'?'等待回答超时，请稍后重试。':'已停止生成；已有内容可能不完整。'):(err instanceof TypeError?'无法连接 DeepSeek，请检查网络后重试。':err.message);
    answer.el.append(p);$('status').textContent='生成未完成 · 可在右侧查看已检索的资料';
  }finally{
    clearTimeout(timer);controller=null;busy(false);
    const refs=document.createElement('div');refs.className='answer-sources';
    hits.forEach((h,i)=>{const b=document.createElement('button');b.type='button';b.textContent=`[${i+1}] 第${h.pages}页`;b.onclick=()=>showSource(i,hits);refs.append(b);});answer.el.append(refs);
    $('question').focus({preventScroll:true});
  }
}
try{
  const response=await fetch('./data/corpus.json');if(!response.ok)throw new Error();corpus=await response.json();
  if(!Array.isArray(corpus.chunks)||!corpus.chunks.length)throw new Error();retrieve=createRetriever(corpus.chunks);
  $('send').disabled=false;$('status').textContent='资料已就绪 · 首次提问时连接 DeepSeek';
}catch{
  $('status').textContent='方言资料加载失败，请刷新页面。';$('question').disabled=true;
}
