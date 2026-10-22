# 尤溪方言 RAG 问答

公开页面： https://xieyouyong.github.io/youxi/youxi_index.html

纯静态页面适用于 GitHub Pages。流程为：问题 → 模型分解检索词 → 浏览器 BM25 字符检索 → 按需联网搜索 → DeepSeek 流式生成“资料原文／AI推测”。属于关键词检索 RAG，本版未使用现有 Python 程序的向量库，也不包含全书 OCR 草稿。

使用者在“连接模型”里输入自己的 DeepSeek API 密钥；密钥只存在当前页面内存，不写入 Git、localStorage、sessionStorage 或 Cookie。页面直接向 `https://api.deepseek.com/chat/completions` 发送问题与命中片段。默认模型 `deepseek-flash`，依据 2026-10-14 DeepSeek 官方 API 文档： https://api-docs.deepseek.com/zh-cn/ 。可在弹窗修改模型名。

本版需要使用者自己的密钥。要提供访客免密钥访问，需要单独部署带密钥管理与访问限额的后端；GitHub Pages 本身不能运行 Python 后端。

## 联网与回答格式

2026-10-15 更新：网页不显示出处栏、来源编号、书名、页码或参考链接。来源元数据仍在知识库内部保留。

按用户指定提示词，回答分成“【资料原文】”和“【AI推测】”。前者仅来自本地记录；后者允许自主比较、推测候选读音和配合表、补全缺失信息，并以“以下为推测，未经方言资料验证，仅供参考。”开头。即使本地无命中，也继续调用模型作明确标注的推测。

联网通过 [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) 实际执行。在连接弹窗输入自己的 Tavily 密钥后，模型判断需要搜索时、比较问题或本地未命中时自动搜索，最多2个搜索词、6条结果。搜索结果仅用于AI推测，不能混入资料原文。未配置搜索密钥或搜索失败时显示实际状态，继续用本地记录与一般知识回答，不声称已经联网。

两个密钥都仅在页面内存中使用；搜索词发送给Tavily，结果与本地片段发送给DeepSeek。问题规划会额外调用一次模型；搜索按Tavily账户额度计费。

## 资料

Markdown 原文只保存在方言项目的 `data/reviewed/尤溪方言_第二章_第一二节_复核稿.md`，含 2026-10-14 用户纠正的“唔烘”；不是全书或第二章全文。网站不再保留一份重复的 source.md。`data/corpus.json` 是生成的发布文件，保留文白读文字标记、出处和原书调值疑点。扫描字形仍有复核风险，首轮复核不等于学术审定。

更新资料后，从仓库根目录运行：

```powershell
python -X utf8 youxi/build_corpus.py --source "E:\Youxi_dialect\data\reviewed\尤溪方言_第二章_第一二节_复核稿.md"
```

页面无外部 JS 库，不需要安装前端依赖或构建工具。正式入口及主页链接为 `youxi/youxi_index.html`。

本地网页代码只保存在 `C:\Users\谢有涌\xieyouyong.github.io\youxi`。`E:\Youxi_dialect\web` 是指向它的目录联接，可从方言项目直接编辑同一份网页；它不是另一个副本。生成脚本从原文路径直接读取，只更新发布用 JSON。

## 发布

先拉取最新 `main`，仅暂存 `youxi/`，再提交并推送。若推送被拒绝，重新 fetch 并把本批提交 rebase 到最新 `origin/main`；不要 force push，不要顺带提交简历等其他板块。GitHub Pages 部署完成后访问页面确认。
