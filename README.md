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

## 双击运行的同步工具

- `01_从GitHub下载更新.cmd`：先获取 GitHub 最新 main，再选择整个网站、某个文件夹或具体文件；输入 YES 后才覆盖。覆盖前将所选范围备份到 `.git/site-sync-backups/时间戳/files/`，并创建 `backup/download-时间戳` 分支保留旧提交。整站模式将 main 对齐到远端；局部模式只更新所选范围，并放入暂存区。不会执行 git clean 删除本地额外文件。
- `02_上传并上线.cmd`：选择发布范围，确认后提交这些文件，再次同步远端并 rebase，然后推送 main，触发 GitHub Pages。范围外的本地改动会临时保存并恢复；对应 stash 也保留作备份。有冲突则停止；不强制推送。此前已有但尚未上传的本地提交也会上传，确认前会列出。

需要 Windows PowerShell 和 Git for Windows；脚本自动定位自身所在仓库，不依赖运行时当前目录。首次使用 GitHub 可能需要通过 Git Credential Manager 登录。下载需要能访问 GitHub，上传需要该仓库的写权限。

下载备份只存在本机 `.git` 中，不会上传。若选“整个网站”，请确认该电脑的未发布修改可以被覆盖；可从备份 files 目录找回。上传成功表示代码已推送，最终上线还需等待 GitHub Pages 部署完成，可查看 https://github.com/xieyouyong/xieyouyong.github.io/actions 。

脚本仅完成静态语法核对，未在真实网站目录执行覆盖或推送，以保留当前本地修改。使用前会显示范围并要求确认。
