@echo off
setlocal
chcp 65001 >nul
set "SITE_SCRIPT_FILE=%~f0"
powershell.exe -NoLogo -NoProfile -Command "$raw=[IO.File]::ReadAllText($env:SITE_SCRIPT_FILE,[Text.Encoding]::UTF8);$mark='### POWERSHELL START ###';$i=$raw.LastIndexOf($mark);if($i -lt 0){throw 'Missing script payload'};& ([ScriptBlock]::Create($raw.Substring($i+$mark.Length)))" & exit /b
### POWERSHELL START ###

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$Root = [IO.Path]::GetFullPath([IO.Path]::GetDirectoryName($env:SITE_SCRIPT_FILE)).TrimEnd('\')
$script:Lock = $null
$ExitCode = 0
function Git-Read {
    param([string[]]$Arguments)
    $result = @(& git --literal-pathspecs -c core.quotepath=false -C $Root @Arguments)
    if ($LASTEXITCODE -ne 0) { throw ('Git 操作失败：' + ($Arguments -join ' ')) }
    return $result
}
function Git-Run {
    param([string[]]$Arguments)
    & git --literal-pathspecs -c core.quotepath=false -C $Root @Arguments
    if ($LASTEXITCODE -ne 0) { throw ('Git 操作失败：' + ($Arguments -join ' ')) }
}
function Confirm-Action {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Yellow
    if ((Read-Host '输入 y 继续，其他输入取消') -cne 'y') { throw '已取消，未执行本次覆盖或上传。' }
}
function Assert-NoLinks {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw ('所选范围含目录联接或符号链接，请缩小选择范围：' + $item.FullName) }
    if ($item.PSIsContainer) {
        foreach ($child in Get-ChildItem -LiteralPath $Path -Force) {
            if ($child.Name -eq '.git') { continue }
            Assert-NoLinks $child.FullName
        }
    }
}
function Initialize-Site {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw '请先安装 Git for Windows，然后重新运行。' }
    $top = [IO.Path]::GetFullPath((Git-Read -Arguments @('rev-parse','--show-toplevel') | Select-Object -First 1)).TrimEnd('\')
    if (-not $top.Equals($Root,[StringComparison]::OrdinalIgnoreCase)) { throw '脚本必须放在网站 Git 仓库的根目录。' }
    $branch = (Git-Read -Arguments @('symbolic-ref','--short','HEAD') | Select-Object -First 1)
    if ($branch -ne 'main') { throw '当前不是 main 分支。请先切换到 main，再运行脚本。' }
    $script:GitDir = [IO.Path]::GetFullPath((Git-Read -Arguments @('rev-parse','--absolute-git-dir') | Select-Object -First 1))
    $script:Lock = [IO.File]::Open((Join-Path $GitDir 'site-sync.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    foreach ($name in @('rebase-merge','rebase-apply','MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','index.lock')) {
        if (Test-Path -LiteralPath (Join-Path $GitDir $name)) { throw '检测到尚未完成的 Git 操作，请先处理后再同步。' }
    }
    if (@(Git-Read -Arguments @('ls-files','-u')).Count -gt 0) { throw '存在尚未解决的冲突，请先处理。' }
    $origin = (Git-Read -Arguments @('remote','get-url','origin') | Select-Object -First 1)
    if ($origin -notmatch '(?i)github\.com[:/]xieyouyong/xieyouyong\.github\.io(?:\.git)?/?$') { throw 'origin 不是预期的个人网站仓库，请检查 Git 远端设置。' }
    Write-Host ('网站目录：' + $Root)
    Write-Host '正在获取 GitHub 最新 main……'
    Fetch-Latest
}
function Fetch-Latest {
    for ($attempt=1; $attempt -le 3; $attempt++) {
        & git -C $Root -c http.version=HTTP/1.1 fetch origin main
        if ($LASTEXITCODE -eq 0) {
            $script:RemoteHead = (Git-Read -Arguments @('rev-parse','origin/main') | Select-Object -First 1).Trim()
            return
        }
        if ($attempt -lt 3) { Write-Host '连接失败，稍后重试……'; Start-Sleep -Seconds 2 }
    }
    throw '获取 GitHub 数据失败。请检查网络和 GitHub 登录；本次没有覆盖文件，也没有强制推送。'
}
function Select-Scope {
    $folders = @()
    $folders += @(Get-ChildItem -LiteralPath $Root -Directory -Force | Where-Object { $_.Name -ne '.git' -and $_.Name -notlike '.local-*' } | ForEach-Object Name)
    $folders += @(Git-Read -Arguments @('ls-tree','-d','--name-only',$RemoteHead))
    $folders = @($folders | Where-Object { $_ -ne '.git' -and $_ -notlike '.local-*' } | Sort-Object -Unique)
    Write-Host ''
    Write-Host '0. 整个网站目录'
    for ($i=0; $i -lt $folders.Count; $i++) { Write-Host (('{0}. {1}' -f ($i+1),$folders[$i])) }
    $answer = (Read-Host '选择编号，或直接输入相对路径（例如 Resume、youxi、index.html）').Trim()
    $number = 0
    if ([int]::TryParse($answer,[ref]$number)) {
        if ($number -eq 0) { return '.' }
        if ($number -lt 1 -or $number -gt $folders.Count) { throw '编号无效。' }
        $answer = $folders[$number-1]
    }
    if ([string]::IsNullOrWhiteSpace($answer)) { throw '未选择路径。' }
    if ([IO.Path]::IsPathRooted($answer) -or $answer.StartsWith('-') -or $answer.Contains(':')) { throw '请使用仓库内的相对路径。' }
    $full = [IO.Path]::GetFullPath((Join-Path $Root $answer))
    if (-not $full.StartsWith($Root+'\',[StringComparison]::OrdinalIgnoreCase)) { throw '路径超出网站目录。' }
    $relative = $full.Substring($Root.Length+1).Replace('\','/').TrimEnd('/')
    foreach ($part in $relative.Split('/')) {
        if ($part -eq '.git' -or $part -like '.local-*' -or $part -eq '..' -or $part -eq '.env' -or $part -like '.env.*') { throw '不能选择 Git 元数据、私密配置或本地预览目录。' }
    }
    $parent = $full
    while ($parent.Length -gt $Root.Length) {
        if (Test-Path -LiteralPath $parent) {
            $entry = Get-Item -LiteralPath $parent -Force
            if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '不能通过目录联接或符号链接同步外部文件。' }
        }
        $parent = [IO.Path]::GetDirectoryName($parent)
    }
    return $relative
}
function Finish-Script {
    if ($Lock) { $Lock.Dispose() }
    Write-Host ''
    try { [void](Read-Host '按回车关闭窗口') } catch {}
}

$script:SavedStash = $null
$script:Pushed = $false
function Restore-Work {
    if (-not $script:SavedStash) { return }
    Write-Host '恢复上传范围以外的本地改动……'
    & git -C $Root stash apply --index $script:SavedStash
    if ($LASTEXITCODE -ne 0) {
        throw ('本地改动恢复时有冲突。备份仍保留在 Git stash，编号：'+$script:SavedStash+'。请先处理冲突，不要删除该 stash。')
    }
    # Keep the snapshot as a recoverable backup instead of deleting user work.
    Write-Host ('额外备份已保留在 Git stash：' + $script:SavedStash)
    $script:SavedStash = $null
}
function Rebase-Latest {
    try { Git-Run -Arguments @('rebase',$RemoteHead) }
    catch {
        & git -C $Root rebase --abort
        if ($LASTEXITCODE -ne 0) { throw '合并出现冲突，且自动撤回未成功。请保留当前文件并先处理 Git rebase。' }
        throw '你的修改与 GitHub 更新冲突，已撤回本次 rebase；本地提交保留。请手动合并后再上传，不会强行覆盖远端。'
    }
}
try {
    Write-Host '=== 上传并触发网站上线 ===' -ForegroundColor Cyan
    Initialize-Site
    $scope = Select-Scope
    $full = if ($scope -eq '.') { $Root } else { Join-Path $Root $scope }
    Assert-NoLinks $full
    Write-Host ('准备上传的范围：'+$scope)
    Git-Run -Arguments @('status','--short','--',$scope)
    $ahead = @(Git-Read -Arguments @('log','--oneline',($RemoteHead+'..HEAD')))
    if ($ahead.Count -gt 0) {
        Write-Host '以下已有本地提交也会一起上传（可能涉及所选范围以外的文件）：' -ForegroundColor Yellow
        $ahead | ForEach-Object { Write-Host $_ }
        Git-Run -Arguments @('diff','--stat',($RemoteHead+'...HEAD'))
    }
    Confirm-Action '脚本将提交所选改动、合并 GitHub 最新内容并上传 main。确认继续？'
    Git-Run -Arguments @('add','-A','--',$scope)
    $names = @(Git-Read -Arguments @('diff','--cached','--name-only','--',$scope))
    foreach ($name in $names) {
        if ($name -match '(?i)(^|/)(\.env(?:\..*)?|\.local-[^/]*|node_modules)(/|$)|\.(pem|key)$') {
            throw ('暂存范围包含私密配置或本地文件，请移除后重试：'+$name)
        }
    }
    $added = @(Git-Read -Arguments @('diff','--cached','--unified=0','--',$scope)) | Where-Object { $_ -match '^\+[^+]' }
    if (@($added | Where-Object { $_ -match '(?i)\b(sk-[a-z0-9_-]{16,}|tvly-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,})' }).Count -gt 0) {
        throw '发现疑似 API 密钥，已停止上传。请从文件中移除密钥后重试。'
    }
    if ($names.Count -gt 0) {
        Git-Run -Arguments @('diff','--cached','--stat','--',$scope)
        $message = Read-Host '提交说明（直接回车使用默认说明）'
        if ([string]::IsNullOrWhiteSpace($message)) { $message = 'Update website '+(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') }
        Git-Run -Arguments @('commit','--only','-m',$message,'--',$scope)
    } else { Write-Host '所选范围没有新的文件改动；将同步已有提交。' }
    $remaining = @(Git-Read -Arguments @('status','--porcelain','--untracked-files=all'))
    if ($remaining.Count -gt 0) {
        Git-Run -Arguments @('stash','push','--include-untracked','-m',('Before website publish '+(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')))
        $script:SavedStash = (Git-Read -Arguments @('rev-parse','refs/stash') | Select-Object -First 1).Trim()
    }
    Fetch-Latest
    Rebase-Latest
    for ($attempt=1; $attempt -le 2; $attempt++) {
        & git -C $Root -c http.version=HTTP/1.1 push origin HEAD:main
        if ($LASTEXITCODE -eq 0) { $script:Pushed = $true; break }
        if ($attempt -eq 2) { throw '推送未成功。本地提交已经保留；检查网络或登录后可再次运行。没有使用强制推送。' }
        Write-Host '推送未成功，重新同步远端后重试一次……'
        Fetch-Latest
        Rebase-Latest
    }
    Restore-Work
    Write-Host ''
    Write-Host '代码已上传，GitHub Pages 将自动构建并发布。' -ForegroundColor Green
    Write-Host '部署可能需要几分钟；看到推送成功不等于部署已完成。'
    Write-Host '网站：https://xieyouyong.github.io/'
    Write-Host '部署状态：https://github.com/xieyouyong/xieyouyong.github.io/actions'
} catch {
    $ExitCode = 1
    Write-Host ('操作停止：'+$_.Exception.Message) -ForegroundColor Red
    if ($Pushed) { Write-Host '注意：代码已经上传成功，当前问题发生在本地改动恢复阶段。' -ForegroundColor Yellow }
    if ($SavedStash) {
        $hasRebase = (Test-Path -LiteralPath (Join-Path $GitDir 'rebase-merge')) -or (Test-Path -LiteralPath (Join-Path $GitDir 'rebase-apply'))
        if (-not $hasRebase -and @(Git-Read -Arguments @('ls-files','-u')).Count -eq 0) {
            try { Restore-Work } catch { Write-Host $_.Exception.Message -ForegroundColor Yellow }
        }
        if ($SavedStash) { Write-Host ('本地额外改动仍保存在 Git stash：'+$SavedStash) -ForegroundColor Yellow }
    }
} finally { Finish-Script }
exit $ExitCode
