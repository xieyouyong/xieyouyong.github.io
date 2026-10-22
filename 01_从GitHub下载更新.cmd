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
    if ((Read-Host '输入 YES 继续，其他输入取消') -cne 'YES') { throw '已取消，未执行本次覆盖或上传。' }
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

function Backup-Directory {
    param([string]$Source,[string]$Destination)
    $entry = Get-Item -LiteralPath $Source -Force
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '备份遇到链接，已停止。' }
    if (-not $entry.PSIsContainer) {
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Destination)) | Out-Null
        Copy-Item -LiteralPath $Source -Destination $Destination -Force
        return
    }
    [IO.Directory]::CreateDirectory($Destination) | Out-Null
    foreach ($child in Get-ChildItem -LiteralPath $Source -Force) {
        if ($child.Name -eq '.git') { continue }
        Backup-Directory $child.FullName (Join-Path $Destination $child.Name)
    }
}
try {
    Write-Host '=== 从 GitHub 下载并覆盖 ===' -ForegroundColor Cyan
    Initialize-Site
    $scope = Select-Scope
    $full = if ($scope -eq '.') { $Root } else { Join-Path $Root $scope }
    $remoteFiles = @(Git-Read -Arguments @('ls-tree','-r','--name-only',$RemoteHead,'--',$scope))
    if ($remoteFiles.Count -eq 0) { throw 'GitHub 上没有这个路径。不会清空本地文件。' }
    Assert-NoLinks $full
    Write-Host ('目标范围：' + $scope)
    Write-Host ('远端提交：' + $RemoteHead)
    Write-Host '当前本地改动：'
    Git-Run -Arguments @('status','--short','--',$scope)
    Write-Host '将覆盖所选范围内 Git 管理的文件；本地额外文件不会通过 git clean 删除。'
    Write-Host '覆盖前会自动备份所选文件，并保留当前提交的备份分支。'
    Confirm-Action '确认用 GitHub 版本覆盖所选本地内容？'
    $stamp = (Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6)
    $backup = Join-Path $GitDir ('site-sync-backups\'+$stamp)
    $snapshot = if ($scope -eq '.') { Join-Path $backup 'files' } else { Join-Path (Join-Path $backup 'files') $scope }
    [IO.Directory]::CreateDirectory($backup) | Out-Null
    if (Test-Path -LiteralPath $full) { Backup-Directory $full $snapshot }
    $oldHead = (Git-Read -Arguments @('rev-parse','HEAD') | Select-Object -First 1).Trim()
    $info = @{scope=$scope;old_commit=$oldHead;remote_commit=$RemoteHead;created=(Get-Date).ToString('o')}
    $info | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'info.json') -Encoding UTF8
    Git-Run -Arguments @('branch',('backup/download-'+$stamp),$oldHead)
    Write-Host ('本地备份：' + $backup) -ForegroundColor Green
    if ($scope -eq '.') {
        Git-Run -Arguments @('reset','--hard',$RemoteHead)
    } else {
        Git-Run -Arguments @('restore',('--source='+$RemoteHead),'--staged','--worktree','--',$scope)
    }
    Write-Host ''
    Write-Host '下载覆盖完成。此操作没有向 GitHub 上传内容。' -ForegroundColor Green
    if ($scope -ne '.') { Write-Host '局部更新已放入 Git 暂存区；其他目录的本地改动保持原状。' }
    Write-Host ('需要恢复旧文件时，请查看：' + $backup)
} catch {
    $ExitCode = 1
    Write-Host ('操作停止：' + $_.Exception.Message) -ForegroundColor Red
} finally { Finish-Script }
exit $ExitCode
