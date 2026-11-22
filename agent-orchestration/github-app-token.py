#!/usr/bin/env python3
import base64
import datetime
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = PROJECT_ROOT / "agent-orchestration" / ".env"
RUNTIME_DIR = PROJECT_ROOT / "agent-orchestration" / ".runtime"
TOKEN_CACHE = RUNTIME_DIR / "gh_app_token.json"
IDENTITY_CACHE = RUNTIME_DIR / "gh_app_identity.json"


def load_env():
    if not ENV_FILE.exists():
        return
    for raw in ENV_FILE.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def mint_installation_token() -> str:
    app_id = os.environ.get("GITHUB_APP_ID", "").strip()
    inst_id = os.environ.get("GITHUB_APP_INSTALLATION_ID", "").strip()
    key_path = os.environ.get("GITHUB_APP_PRIVATE_KEY_PATH", "").strip()
    if not (app_id and inst_id and key_path and Path(key_path).is_file()):
        return ""

    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    now = int(time.time())

    if TOKEN_CACHE.exists():
        try:
            cached = json.loads(TOKEN_CACHE.read_text(encoding="utf-8"))
            if cached.get("token") and int(cached.get("expires_epoch", 0)) - now > 300:
                return cached["token"]
        except Exception:
            pass

    header = b64url(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64url(
        json.dumps({"iat": now - 60, "exp": now + 540, "iss": str(app_id)}, separators=(",", ":")).encode()
    )
    signing_input = f"{header}.{payload}".encode("ascii")

    sig = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", key_path],
        input=signing_input,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    ).stdout
    jwt_token = f"{header}.{payload}.{b64url(sig)}"

    url = f"https://api.github.com/app/installations/{inst_id}/access_tokens"
    req = urllib.request.Request(
        url,
        data=b"{}",
        method="POST",
        headers={
            "Authorization": f"Bearer {jwt_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "lidurak-orchestrator",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    token = data["token"]
    exp_dt = datetime.datetime.fromisoformat(data["expires_at"].replace("Z", "+00:00"))
    TOKEN_CACHE.write_text(
        json.dumps({"token": token, "expires_epoch": int(exp_dt.timestamp())}),
        encoding="utf-8",
    )
    os.chmod(TOKEN_CACHE, 0o600)
    return token


def resolve_bot_identity():
    slug = os.environ.get("GITHUB_APP_SLUG", "").strip()
    if not slug:
        return
    bot_login = f"{slug}[bot]"

    if IDENTITY_CACHE.exists():
        try:
            cached = json.loads(IDENTITY_CACHE.read_text(encoding="utf-8"))
            if cached.get("login") == bot_login and cached.get("email"):
                print(f"{cached['login']}\t{cached['email']}")
                return
        except Exception:
            pass

    url = f"https://api.github.com/users/{urllib.parse.quote(bot_login)}"
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "lidurak-orchestrator",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        user_data = json.loads(resp.read().decode("utf-8"))

    uid = user_data["id"]
    email = f"{uid}+{bot_login}@users.noreply.github.com"
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    IDENTITY_CACHE.write_text(json.dumps({"login": bot_login, "email": email}), encoding="utf-8")
    os.chmod(IDENTITY_CACHE, 0o600)
    print(f"{bot_login}\t{email}")


if __name__ == "__main__":
    load_env()
    if len(sys.argv) > 1 and sys.argv[1] == "--identity":
        resolve_bot_identity()
    else:
        tok = mint_installation_token()
        if tok:
            print(tok)
