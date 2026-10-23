let answerPrompt='';
export function setAnswerPrompt(text){if(!text.trim())throw new Error('回答规则为空');answerPrompt=text.trim();}
// Static retrieval: character bigrams + BM25. No model credentials in this file.
const STOP = new Set(['什么','怎么','如何','哪些','多少','几个','有没有','是否','可以','请问','请举','举例','一下','这个','那个','介绍','解释','告诉','问题','尤溪','溪县','方言','城关','关话','的话','关于','中的','我们','你们','它们']);
export function tokens(text) {
  const s = text.normalize('NFC').toLowerCase();
  const out = s.match(/[a-zəɿøŋɲɕθβʔʰãẽĩũ]+|\d+/gu) || [];
  for (const run of s.match(/[\p{Script=Han}]+/gu) || []) {
    if (run.length === 1) out.push(run);
    for (let i=0; i<run.length-1; i++) {
      const term = run.slice(i,i+2);
      if (!STOP.has(term)) out.push(term);
    }
  }
  return out;
}
export function createRetriever(chunks) {
  const dfs = new Map();
  const docs = chunks.map(chunk => {
    const ts = tokens(chunk.title + ' ' + chunk.title + ' ' + chunk.text);
    const freq = new Map();
    for (const t of ts) freq.set(t,(freq.get(t)||0)+1);
    for (const t of freq.keys()) dfs.set(t,(dfs.get(t)||0)+1);
    return {chunk,freq,len:ts.length,title:new Set(tokens(chunk.title))};
  });
  const avg = docs.reduce((sum,d)=>sum+d.len,0)/docs.length || 1;
  return function retrieve(question, limit=6) {
    const terms = new Set(tokens(question));
    const ranked = docs.map(d => {
      let score=0, matches=0;
      for(const t of terms) {
        const f=d.freq.get(t)||0;
        if(!f) continue;
        matches++;
        const idf=Math.log(1+(docs.length-(dfs.get(t)||0)+.5)/((dfs.get(t)||0)+.5));
        score+=idf*(f*2.2)/(f+1.2*(.25+.75*d.len/avg));
        if(d.title.has(t)) score+=idf*1.6;
      }
      // Exact sample words keep their own source above broad topic descriptions.
      for(const word of question.match(/[\p{Script=Han}]{2,}/gu)||[]) {
        if(word.length<7 && d.chunk.text.includes(word) && !STOP.has(word)) score+=5;
      }
      return { ...d.chunk, score, matches };
    }).filter(d=>d.matches>0).sort((a,b)=>b.score-a.score);
    if(!ranked.length) return [];
    const floor = Math.max(.75,ranked[0].score*.13);
    return ranked.filter(d=>d.score>=floor).slice(0,limit);
  };
}
export function buildMessages(question,hits,history=[],webResults=[],searchState='未联网') {
  if(!answerPrompt)throw new Error('回答规则尚未加载');
  const context=hits.map(h=>`${h.title}\n${h.text}\n${h.note? '校注：'+h.note:''}`).join('\n\n---\n\n') || '本地资料中无相关内容';
  const web=webResults.map(r=>`${r.title}\n${r.content}`).join('\n\n---\n\n') || '没有取得网络搜索结果';
  return [
    {role:'system',content:answerPrompt},
    ...history.slice(-4),
    {role:'user',content:`<本地资料>\n${context}\n</本地资料>\n\n网络状态：${searchState}\n<网络参考，仅用于AI推测>\n${web}\n</网络参考>\n\n问题：${question}`}
  ];
}
