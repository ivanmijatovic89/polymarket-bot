param(
    [string]$Strategy = "winnerLimit",
    [int]$StratSize = 5,
    [double]$StratTriggerPrice = 0.92,
    [double]$StratLimitPrice = 0.92,
    [int]$StratMinDelayMs = 600000,
    [string]$Symbol = "btc",
    [int]$MaxFiles = 10,
    [int]$Concurrency = 0,  # 0 = unlimited (default)
    [int]$Workers = 0       # 0 = disabled, >0 = use worker threads
)

# Get list of parquet files
$files = Get-ChildItem -Path "data/events/$Symbol/*.parquet" | Select-Object -ExpandProperty FullName

if ($files.Count -eq 0) {
    Write-Error "No parquet files found for symbol: $Symbol"
    exit 1
}

if ($MaxFiles -gt 0 -and $MaxFiles -lt $files.Count) {
    $files = $files[0..($MaxFiles - 1)]
    Write-Host "Limited to first $MaxFiles files" -ForegroundColor Cyan
}

Write-Host "Processing $($files.Count) files with strategy: $Strategy" -ForegroundColor Cyan
Write-Host ""

# Build command with optimizations
# Use compiled JS when workers are enabled (tsx doesn't support worker threads)
if ($Workers -gt 0) {
    $cmd = "node dist/cli/backtest-parallel.js --strategy $Strategy --mode orderbook"
    Write-Host "Using compiled JS (required for worker threads)" -ForegroundColor Yellow
} else {
    $cmd = "npx tsx src/cli/backtest-parallel.ts --strategy $Strategy --mode orderbook"
}

if ($Concurrency -gt 0) {
    $cmd += " --concurrency $Concurrency"
    Write-Host "Using concurrency limit: $Concurrency" -ForegroundColor Yellow
}

if ($Workers -gt 0) {
    $cmd += " --workers $Workers"
    Write-Host "Using worker threads: $Workers" -ForegroundColor Green
}

# Add files
$cmd += " " + ($files -join ' ')

Write-Host ""
Write-Host "=== Running Optimized Parallel Backtest ===" -ForegroundColor Magenta
Write-Host "Command: $cmd" -ForegroundColor Gray
Write-Host ""

$startTime = Get-Date
Invoke-Expression $cmd
$exitCode = $LASTEXITCODE
$endTime = Get-Date
$duration = ($endTime - $startTime).TotalSeconds

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "SUCCESS: Parallel backtest completed in $duration seconds" -ForegroundColor Green
} else {
    Write-Host "FAILED: Parallel backtest failed with exit code $exitCode" -ForegroundColor Red
    exit 1
}