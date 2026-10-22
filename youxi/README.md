# 尤溪方言 RAG 问答

公开页面： https://xieyouyong.github.io/youxi/youxi_index.html

页面托管在 GitHub Pages。流程为：输入访问密码 → Cloudflare 验证 → 模型分解检索词 → 浏览器 BM25 字符检索 → Cloudflare 转发模型流式回答。属于关键词检索 RAG，未使用 Python 向量库，也不包含全书 OCR 草稿。

## 连接与后端部署

网页只要求输入访问密码，不要求访客提供 API 密钥。密码只在页面内存中保存，刷新清除。真正的模型密钥与访问密码保存在 Cloudflare Secrets 中，不写入前端代码或 Git。

公开后端地址：https://youxi-rag-api.youyongxie.workers.dev

后端源码和部署说明保存在 `E:\Youxi_dialect\cloudflare`；不复制到个人网站目录。需要将 worker.js 部署到已创建的 Worker，并设置 DEEPSEEK_API_KEY 与 ACCESS_PASSWORD，前端才能连接。默认模型与旧版相同为 deepseek-flash，可在 Worker 的 MODEL 设置中更换。

密码登录验证本身不调用模型。一次提问通常包含一次检索词规划与一次回答生成，消耗站长的 DeepSeek 额度。Worker 内存限流只提供基础保护，不构成严格每日预算，扩大使用前需增加持久化配额。

## 回答与联网

回答分为“【资料原文】”和“【AI推测】”：前者只使用本地记载，后者允许自主比较与推测，并以“以下为推测，未经方言资料验证，仅供参考。”开头。没有本地命中时仍可生成明确标注的推测。

按要求不显示出处、书名、原书页码或参考链接；来源元数据保留在知识库内部。

当前暂不接入 Tavily，不显示搜索密钥输入框，也不进行互联网搜索。知识库下载和模型 API 调用不等于联网搜索资料。页面明确显示本次未联网。

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
