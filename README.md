# xieyouyong.github.io
Personal Site of Xie, Youyong

## 本地目录与发布

网站的唯一工作目录是 `C:\Users\谢有涌\xieyouyong.github.io`，所有页面和资源在此提交、发布。首页为 `index.html`，简历为 `Resume/Resume_index.html`，最新 PDF 保存在 `Resume/`，方言网页为 `youxi/`，工具为 `tool/`。

`E:\Youxi_dialect` 用于尤溪方言原始资料、复核稿、模型、向量库和本地处理程序；其中 `web` 为指向本仓库 `youxi` 目录的 Windows 目录联接。通过两个入口编辑的是同一份方言网页代码，不需要来回复制。旧 `E:\Youxi_dialect\site-publish` 不再使用。

从本仓库根目录直接读取方言复核稿并生成发布数据：

```powershell
python -X utf8 youxi/build_corpus.py --source "E:\Youxi_dialect\data\reviewed\尤溪方言_第二章_第一二节_复核稿.md"
```

Markdown 原文只存于方言项目；网站提交可在浏览器加载的 `youxi/data/corpus.json`。此 JSON 是构建产物，不是需要手动同步的源文件。

主页与简历页共用 `assets/site.css`。原始 logo 只复制一次，保存为 `assets/logo.jpg`，通过相对路径用作页头图标、浏览器标签图标和分享图片。

发布前先同步远端最新 `main` 并检查本地未提交修改，再提交本次需要更新的文件。不要强制推送；若远端出现新提交，应先合并更新，再发布，避免覆盖其他电脑的修改。
