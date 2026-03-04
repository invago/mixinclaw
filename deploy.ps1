# MixinClaw 部署脚本
# 参考飞书插件架构：无编译，直接运行时 TypeScript

$ErrorActionPreference = "Stop"

$source = "E:\AI\mixin-claw"
$dest = "C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\mixin"

Write-Host "=== MixinClaw 部署脚本 ===" -ForegroundColor Cyan
Write-Host "源目录：$source"
Write-Host "目标目录：$dest"
Write-Host ""

# 步骤 1：清理目标目录
Write-Host "[1/3] 清理目标目录..." -ForegroundColor Yellow
if (Test-Path $dest) {
    Remove-Item -Path $dest -Recurse -Force
    Write-Host "  ✓ 已清理" -ForegroundColor Green
} else {
    Write-Host "  ✓ 目录不存在，跳过清理" -ForegroundColor Green
}

# 步骤 2：创建目标目录
Write-Host "[2/3] 创建目标目录..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Write-Host "  ✓ 已创建" -ForegroundColor Green

# 步骤 3：复制文件（排除 .git, node_modules, dist, .env）
Write-Host "[3/3] 复制文件..." -ForegroundColor Yellow
$exclude = @('.git', 'node_modules', 'dist', '.env')
Get-ChildItem -Path $source | 
    Where-Object { $_.Name -notin $exclude } |
    Copy-Item -Destination $dest -Recurse -Force
Write-Host "  ✓ 已复制" -ForegroundColor Green

# 验证部署
Write-Host ""
Write-Host "=== 验证部署 ===" -ForegroundColor Cyan

$requiredFiles = @('index.ts', 'package.json', 'openclaw.plugin.json', 'src')
foreach ($file in $requiredFiles) {
    $path = Join-Path $dest $file
    if (Test-Path $path) {
        Write-Host "  ✓ $file 存在" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $file 缺失!" -ForegroundColor Red
    }
}

# 验证 src 目录
$srcFiles = @('channel.ts', 'send-service.ts', 'inbound-handler.ts', 'runtime.ts')
Write-Host ""
Write-Host "检查 src/ 目录:" -ForegroundColor Cyan
foreach ($file in $srcFiles) {
    $path = Join-Path $dest "src" $file
    if (Test-Path $path) {
        Write-Host "  ✓ src/$file 存在" -ForegroundColor Green
    } else {
        Write-Host "  ✗ src/$file 缺失!" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=== 部署完成 ===" -ForegroundColor Green
Write-Host ""
Write-Host "下一步：" -ForegroundColor Cyan
Write-Host "1. 重启 OpenClaw: openclaw start"
Write-Host "2. 观察日志，应该看到 [mixin] connecting to Mixin Blaze"
Write-Host "3. 连接会持续重试（永不放弃机制）"
Write-Host ""
