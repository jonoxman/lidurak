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

echo "=== 5. Starting Docker Daemon ==="
sudo service docker start || true
echo "✅ WSL Dependencies Installed!"
