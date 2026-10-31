## Step-by-Step Setup for a New Windows 10/11 Machine (PC #2)

### Step 1: Run the Windows Host Bootstrap Script (PowerShell as Administrator)
Open **Windows PowerShell as Administrator** on the new PC and run:

```powershell
$ErrorActionPreference = "Stop"

Write-Host "=== 1. Checking WSL 2 & Ubuntu Installation ===" -ForegroundColor Cyan
$wslStatus = wsl.exe --status 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing WSL 2 and Ubuntu..." -ForegroundColor Yellow
    wsl.exe --install -d Ubuntu
    Write-Host "⚠️ If Windows prompts for a reboot to finish WSL 2 installation, reboot and re-run this script." -ForegroundColor Yellow
} else {
    $distros = wsl.exe --list --quiet
    if ($distros -notmatch "Ubuntu") {
        wsl.exe --install -d Ubuntu
    }
}

Write-Host "=== 2. Hardening WSL Sandbox (/etc/wsl.conf) ===" -ForegroundColor Cyan
$wslConf = @'
[automount]
enabled = false
mountFsTab = false

[interop]
enabled = false
appendWindowsPath = false

[boot]
systemd = true
'@
$wslConf | wsl.exe -d Ubuntu -u root tee /etc/wsl.conf >$null
Write-Host "Restarting WSL to apply security quarantine..." -ForegroundColor Yellow
wsl.exe --shutdown
Start-Sleep -Seconds 3

Write-Host "=== 3. Creating Multi-Worker Mission Control Launcher ===" -ForegroundColor Cyan
@'
param(
    [int]$Workers = 3
)

Write-Host "🚀 Launching Lidurak Parallel Mission Control ($Workers Workers)..." -ForegroundColor Cyan

# Window 1: Parallel Orchestrator (Boots Docker workers & manages GitHub PR pipeline)
Start-Process wsl.exe -ArgumentList "-e bash -ic `"cd ~/agent-project && ./agent-orchestration/orchestrate.sh --workers $Workers; exec bash`""
Start-Sleep -Seconds 1

# Window 2: Multi-Worker FreeBuff Viewer (Switch between workers 1..N with Ctrl+A then 1/2/3)
Start-Process wsl.exe -ArgumentList "-e bash -ic `"cd ~/agent-project && ./agent-orchestration/watch-workers.sh $Workers; exec bash`""
Start-Sleep -Seconds 1

# Window 3: Live PR, Test Gate & Review Monitor
Start-Process wsl.exe -ArgumentList "-e bash -ic `"cd ~/agent-project && ./agent-orchestration/watch-reviews.sh; exec bash`""
Start-Sleep -Seconds 1

# Window 4: Interactive Command Line (For play-local.sh, gh pr list, git sync)
Start-Process wsl.exe -ArgumentList "-e bash -ic `"cd ~/agent-project && clear && echo === Interactive Shell: ~/agent-project === && exec bash`""

Write-Host "✅ All 4 Mission Control windows launched!" -ForegroundColor Green
'@ | Set-Content -Path "$HOME\mission-control.ps1" -Encoding UTF8

Write-Host "✅ Windows host setup complete!" -ForegroundColor Green
```

---

### Step 2: Install WSL Linux Dependencies (Inside Ubuntu WSL Terminal)
Open the **Ubuntu** terminal on PC #2 and paste this installer block to set up Docker Engine, GitHub CLI (`gh`), `tmux`, `jq`, and Node.js:

```bash
cat << 'EOF' > ~/install-wsl-deps.sh
#!/usr/bin/env bash
set -euo pipefail

echo "=== 1. Installing Core Linux Packages ==="
sudo apt-get update
sudo apt-get install -y \
  ca-certificates curl gnupg lsb-release wget git tmux jq python3 util-linux

echo "=== 2. Installing Official GitHub CLI (gh) ==="
if ! command -v gh >/dev/null 2>&1; then
  sudo mkdir -p -m 755 /etc/apt/keyrings
  wget -nv -O- https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y gh
fi

echo "=== 3. Installing Native Docker Engine inside WSL ==="
if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"
fi

echo "$USER ALL=(ALL) NOPASSWD: /usr/sbin/service docker *, /usr/bin/dockerd" | sudo tee /etc/sudoers.d/docker-wsl >/dev/null
sudo chmod 0440 /etc/sudoers.d/docker-wsl

echo "=== 4. Installing Node.js 22 LTS ==="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

sudo service docker start || true
echo "✅ WSL Dependencies Installed!"
EOF
chmod +x ~/install-wsl-deps.sh
~/install-wsl-deps.sh
```

---

### Step 3: Authenticate & Clone the Repository on PC #2
Still inside the Ubuntu WSL terminal on PC #2:

```bash
# 1. Activate docker group permissions
newgrp docker

# 2. Log in to GitHub CLI & Antigravity CLI
gh auth login
agy auth login

# 3. Clone your private Lidurak repo from GitHub
gh repo clone lidurak ~/agent-project
cd ~/agent-project

# 4. Boot the 3 isolated worker containers & log in to FreeBuff once
./agent-orchestration/start-workspace.sh 3
docker exec -it freebuff_worker_1 freebuff
# (Complete browser login link shown in terminal, then press Ctrl+C to exit)
```

---

## Daily Multi-PC Sync & Parallel Worker Controls

### Switching Between PCs
- **Before leaving a PC:**
  ```bash
  ./agent-orchestration/sync-pc.sh push
  ```
- **When sitting down at another PC:**
  ```bash
  ./agent-orchestration/sync-pc.sh pull
  ```

### Launching & Controlling the 4-Window Mission Control
From Windows PowerShell:
```powershell
powershell -ExecutionPolicy Bypass -File "$HOME\mission-control.ps1" -Workers 3
```
- **Window 1 (`orchestrate.sh`):** Decomposes `SPEC.md` and `FEEDBACK.md` into parallel Execution Waves (`WAVE:1`, `WAVE:2`, etc.), dispatches tickets to `freebuff_worker_1..3`, opens GitHub Pull Requests, posts AI code reviews directly to PR comments, resolves merge conflicts, and merges approved PRs into `main`.
- **Window 2 (`watch-workers.sh`):** Live full-screen viewer for all parallel FreeBuff sessions.
  - Press **`Ctrl+A`**, release, then tap **`1`**, **`2`**, or **`3`** to switch between Worker 1, Worker 2, and Worker 3.
  - Inside any worker tab, standard **`Ctrl+B`** keystrokes pass cleanly into that container's `tmux` session.
- **Window 3 (`watch-reviews.sh`):** Displays live worker status lines (`🔨 Implementing`, `🧪 Testing`, `🔍 Reviewing`, `☁️ Pushing PR`) and streams the newest review or test gate report.
- **Window 4 (Interactive Shell):** Run `./agent-orchestration/play-local.sh` to test at `http://localhost:5173`, `./agent-orchestration/ask-architect.sh "..."` to query the codebase, or `gh pr list` to inspect GitHub PRs.


## Adding and Removing Agents
- Add or remove more workers: ./agent-orchestration/scale-workers.sh N (N = total number of workers). Workers will be shut off after they are finished their current ticket. --now tag can be used to force shut off instead.
- 

