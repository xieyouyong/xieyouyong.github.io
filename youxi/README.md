# 尤溪方言 RAG 问答

公开页面： https://xieyouyong.github.io/youxi/youxi_index.html

纯静态页面适用于 GitHub Pages。流程为：问题 → 浏览器 BM25 字符检索 → 将检索片段与问题交给 DeepSeek → 流式回答 → 来源片段及原书页码。属于关键词检索 RAG，本版未使用现有 Python 程序的向量库，也不包含全书 OCR 草稿。

使用者在“连接模型”里输入自己的 DeepSeek API 密钥；密钥只存在当前页面内存，不写入 Git、localStorage、sessionStorage 或 Cookie。页面直接向 `https://api.deepseek.com/chat/completions` 发送问题与命中片段。默认模型 `deepseek-flash`，依据 2026-10-14 DeepSeek 官方 API 文档： https://api-docs.deepseek.com/zh-cn/ 。可在弹窗修改模型名。

本版需要使用者自己的密钥。要提供访客免密钥访问，需要单独部署带密钥管理与访问限额的后端；GitHub Pages 本身不能运行 Python 后端。

## 资料

`data/source.md` 是第二章第一、二节首轮复核稿，含 2026-10-14 用户纠正的“唔烘”；不是全书或第二章全文。`data/corpus.json` 是可检索片段，保留文白读文字标记、出处、原书调值疑点。扫描字形仍有复核风险，首轮复核不等于学术审定。

更新资料后，从仓库根目录运行：

```powershell
python -X utf8 youxi/build_corpus.py
```

页面无外部 JS 库，不需要安装前端依赖或构建工具。`youxi/index.html` 兼容 `/youxi/` 入口，现有主页链接保持 `youxi/youxi_index.html`。

## 发布

先拉取最新 `main`，仅暂存 `youxi/`，再提交并推送。若推送被拒绝，重新 fetch 并把本批提交 rebase 到最新 `origin/main`；不要 force push，不要顺带提交简历等其他板块。GitHub Pages 部署完成后访问页面确认。
