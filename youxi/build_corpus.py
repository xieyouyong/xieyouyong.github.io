"""Build a static corpus from the reviewed source, retaining source pages."""
from pathlib import Path
import argparse
import json
import re
import hashlib

DATA = Path(__file__).parent / 'data'
parser = argparse.ArgumentParser(description='Build the website corpus directly from a reviewed Markdown file.')
parser.add_argument('--source', type=Path, required=True, help='Reviewed Markdown source in the dialect project; read directly without copying it into the website.')
args = parser.parse_args()
source = args.source
raw = source.read_text(encoding='utf-8')
blocks = []
parts = []
section = ''
subsection = ''
detail = ''
page = '6'
in_code = False

def flush():
    if not parts:
        return
    text = '\n'.join(parts).strip()
    parts.clear()
    if not text or text == '---' or text.startswith('>') or text.startswith('[^'):
        return
    title = ' / '.join(x for x in (section, subsection, detail) if x)
    blocks.append({'title': title, 'pages': page, 'text': text})

for line in raw.splitlines():
    if line.startswith('<!-- 来源：'):
        flush()
        match = re.search(r'原书第(\d+)页', line)
        if match:
            page = match.group(1)
        continue
    head = re.match(r'^(#{1,4})\s+(.*)$', line)
    if head and not in_code:
        flush()
        level = len(head.group(1))
        if level == 2:
            section = head.group(2); subsection = ''; detail = ''
        elif level == 3:
            subsection = head.group(2); detail = ''
        elif level == 4:
            detail = head.group(2)
        continue
    if not section:
        continue
    if line.startswith('```'):
        in_code = not in_code
    if not line.strip() and not in_code:
        flush()
    else:
        parts.append(line)
flush()

chunks = []
for block in blocks:
    if block['text'].startswith('```') and chunks and chunks[-1]['title'] == block['title']:
        chunks[-1]['text'] += '\n\n' + block['text']
        continue
    chunks.append(block)

for i, chunk in enumerate(chunks, 1):
    text = chunk['text']
    text = re.sub(r'<u style="text-decoration: underline double;">(.*?)</u>', r'\1（文读）', text)
    text = re.sub(r'<u>(.*?)</u>', r'\1（白读）', text)
    text = text.replace('[^疑点1]', '')
    notes = []
    if '213' in text:
        notes.append('原书作“阴平”，与本节表列阴平33不同；人群间调值差异或排印问题尚未核定，不擅改为阳平。')
    if '葡萄' in text or '劳神' in text:
        notes.append('葡萄的12-13、劳神的12-3按原书保留，尚待确认是否为排印遗漏或特殊读法；不自动改作12-33。')
    if '欠债' in text and '清粉' in text:
        chunk['pages'] = '8–9'
    chunk.update(id=f'youxi-ch2-{i:03d}', text=text, note=' '.join(notes))

payload = {
    'title': '尤溪县方言志 · 第二章第一、二节',
    'coverage': '原书第6–9页，城关话',
    'status': '首轮复核，含2026-10-14用户校正',
    'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'chunks': chunks,
}
(DATA / 'corpus.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'已生成 {len(chunks)} 个资料片段，范围：{payload["coverage"]}')
