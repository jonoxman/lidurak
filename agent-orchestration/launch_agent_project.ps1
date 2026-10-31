@'
Write-Host "🚀 Launching Lidurak Mission Control (4 Separate Windows)..." -ForegroundColor Cyan

# Window 1: Main Autopilot Orchestrator (Visibly boots Docker workspace & runs pipeline)
Start-Process wsl.exe -ArgumentList '-e bash -ic "cd ~/agent-project && ./agent-orchestration/orchestrate.sh; exec bash"'
Start-Sleep -Seconds 1

# Window 2: FreeBuff Live Agent TUI (Waits for container/session & auto-reconnects)
Start-Process wsl.exe -ArgumentList '-e bash -ic "cd ~/agent-project && ./agent-orchestration/wait-for-freebuff.sh; exec bash"'
Start-Sleep -Seconds 1

# Window 3: Antigravity Review & Test Gate Watcher
Start-Process wsl.exe -ArgumentList '-e bash -ic "cd ~/agent-project && ./agent-orchestration/watch-reviews.sh; exec bash"'
Start-Sleep -Seconds 1

# Window 4: Interactive Command Line (Ready for play-local.sh, ask-architect.sh, or git)
Start-Process wsl.exe -ArgumentList '-e bash -ic "cd ~/agent-project && clear && echo === Interactive Shell: ~/agent-project === && exec bash"'

Write-Host "✅ All 4 windows launched!" -ForegroundColor Green
'@ | Set-Content -Path "$HOME\mission-control.ps1" -Encoding UTF8

powershell -ExecutionPolicy Bypass -File "$HOME\mission-control.ps1"
