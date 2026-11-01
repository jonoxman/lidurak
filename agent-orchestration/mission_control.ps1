param(
    [int]$Workers = 3
)

Write-Host "🚀 Launching Lidurak Parallel Mission Control ($Workers Workers)..." -ForegroundColor Cyan

# Window 1: Main Orchestrator (3-Pool Router + Auto-Milestone + Shared Auth)
Start-Process wsl.exe -ArgumentList "--cd ~/lidurak-agent-project -e bash -lc `"./agent-orchestration/orchestrate.sh --workers $Workers; exec bash`""
Start-Sleep -Seconds 2

# Window 2: Multi-Worker FreeBuff Tabbed Viewer (Ctrl+A then 1..N to switch workers)
Start-Process wsl.exe -ArgumentList "--cd ~/lidurak-agent-project -e bash -lc `"./agent-orchestration/watch-workers.sh $Workers; exec bash`""
Start-Sleep -Seconds 1

# Window 3: Live Worker Pool, Test Gate & PR Review Monitor
Start-Process wsl.exe -ArgumentList "--cd ~/lidurak-agent-project -e bash -lc `"./agent-orchestration/watch-reviews.sh; exec bash`""
Start-Sleep -Seconds 1

# Window 4: Interactive Command Line (Opens standard login bash directly in ~/lidurak-agent-project)
Start-Process wsl.exe -ArgumentList "--cd ~/lidurak-agent-project"

Write-Host "✅ All 4 windows launched!" -ForegroundColor Green
