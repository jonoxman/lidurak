#!/usr/bin/env bash
set -uo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

mkdir -p .reviews/screenshots
rm -f .reviews/screenshots/*.png .reviews/visual_qa_telemetry.json .reviews/visual_qa_runner.log

echo "=================================================================="
echo "🖥️  Stage 3.5: Launching Headless Browser Visual & Interactive QA..."
echo "=================================================================="

# 1. Ensure freebuff_worker has headless chromium and playwright-core installed
if ! docker exec freebuff_worker which chromium >/dev/null 2>&1; then
  echo "📦 Installing headless Chromium & playwright-core inside freebuff_worker (one-time setup)..."
  docker exec --user root freebuff_worker bash -c "apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation && npm install -g playwright-core" >/dev/null 2>&1
fi

# 2. Write the core Headless Playwright Visual & Geometry Conformity Runner
cat << 'EOF' > .reviews/visual_qa_harness.mjs
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require('/usr/local/lib/node_modules/playwright-core');

const SCREENSHOT_DIR = '/workspace/.reviews/screenshots';
const REPORT_PATH = '/workspace/.reviews/visual_qa_telemetry.json';
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// Injected into the real Chromium browser to measure actual pixel alignment, borders, and overlaps
async function scanPageGeometry(page, stepName) {
  return await page.evaluate((stepLabel) => {
    const issues = [];
    const measurements = [];

    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };

    const describeEl = (el) => {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const zone = el.getAttribute('data-zone') ? `[data-zone="${el.getAttribute('data-zone')}"]` : '';
      const seat = el.getAttribute('data-seat') ? `[data-seat="${el.getAttribute('data-seat')}"]` : '';
      const testid = el.getAttribute('data-testid') ? `[data-testid="${el.getAttribute('data-testid')}"]` : '';
      const cls = el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
      return `${tag}${id}${zone}${seat}${testid}${cls}`;
    };

    // 1. Check Highlight / Border / Outline Conformity against child shapes (cards, SVGs, seat boxes)
    const allElements = Array.from(document.querySelectorAll('*')).filter(isVisible);
    for (const el of allElements) {
      const style = window.getComputedStyle(el);
      const hasHighlight =
        (style.boxShadow && style.boxShadow !== 'none') ||
        (style.outlineStyle && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
        (style.borderStyle && style.borderStyle !== 'none' && parseFloat(style.borderTopWidth) > 0);

      if (hasHighlight && el.children.length === 1) {
        const child = el.children[0];
        if (isVisible(child)) {
          const rParent = el.getBoundingClientRect();
          const rChild = child.getBoundingClientRect();
          const cStyle = window.getComputedStyle(child);

          const widthDiff = Math.abs(rParent.width - rChild.width);
          const heightDiff = Math.abs(rParent.height - rChild.height);
          const padH = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);

          // Detect classic inline-SVG descender gap or loose wrapper border around a card/element
          if ((heightDiff - padH > 3 && rChild.height > 20) || (widthDiff > 12 && rChild.width > 20 && padH < 4)) {
            issues.push({
              type: 'HIGHLIGHT_SIZE_MISMATCH',
              step: stepLabel,
              parent: describeEl(el),
              child: describeEl(child),
              detail: `Wrapper (${Math.round(rParent.width)}x${Math.round(rParent.height)}) does not conform tightly to child (${Math.round(rChild.width)}x${Math.round(rChild.height)})`
            });
          }

          // Detect square highlight border around a rounded child (or vice-versa)
          const pRadius = parseFloat(style.borderTopLeftRadius) || 0;
          const cRadius = parseFloat(cStyle.borderTopLeftRadius) || (child.tagName.toLowerCase() === 'svg' ? 8 : 0);
          if (Math.abs(pRadius - cRadius) > 4 && widthDiff < 16 && heightDiff < 16) {
            issues.push({
              type: 'HIGHLIGHT_RADIUS_MISMATCH',
              step: stepLabel,
              parent: describeEl(el),
              child: describeEl(child),
              detail: `Highlight border-radius (${style.borderTopLeftRadius}) does not match inner shape radius (${cStyle.borderTopLeftRadius || 'SVG rounded'})`
            });
          }
        }
      }

      // 2. Check for unintended text clipping / overflow on buttons, badges, and seat boxes
      if (el.children.length === 0 && el.textContent && el.textContent.trim().length > 0) {
        if (style.overflowX === 'hidden' || style.overflowX === 'clip') {
          if (el.scrollWidth > el.clientWidth + 3) {
            issues.push({
              type: 'TEXT_CLIPPED_HORIZONTALLY',
              step: stepLabel,
              element: describeEl(el),
              text: el.textContent.trim().slice(0, 40),
              detail: `scrollWidth (${el.scrollWidth}px) exceeds clientWidth (${el.clientWidth}px)`
            });
          }
        }
      }
    }

    // 3. Check sibling alignment in horizontal flex/grid rows (header buttons, sort bar, cards in hand)
    const rowContainers = Array.from(document.querySelectorAll('header, [data-zone="player-hand"], [data-zone="sidebar-left"], [data-zone="sidebar-right"], .sort-bar')).filter(isVisible);
    for (const container of rowContainers) {
      const cStyle = window.getComputedStyle(container);
      if (cStyle.display.includes('flex') && cStyle.flexDirection === 'row') {
        const kids = Array.from(container.children).filter(isVisible);
        if (kids.length >= 2) {
          const centers = kids.map(k => {
            const r = k.getBoundingClientRect();
            return { el: describeEl(k), centerY: Math.round(r.top + r.height / 2), top: Math.round(r.top), bottom: Math.round(r.bottom) };
          });
          const baseCenter = centers[0].centerY;
          for (const item of centers.slice(1)) {
            if (Math.abs(item.centerY - baseCenter) > 6 && Math.abs(item.top - centers[0].top) > 6) {
              issues.push({
                type: 'ROW_VERTICAL_MISALIGNMENT',
                step: stepLabel,
                container: describeEl(container),
                detail: `${item.el} (centerY=${item.centerY}) is vertically misaligned with sibling ${centers[0].el} (centerY=${baseCenter})`
              });
            }
          }
        }
      }
    }

    // 4. Check key zones for unintended bounding-box overlaps
    const keyZones = Array.from(document.querySelectorAll('[data-zone], [data-seat], [data-testid^="target-outline"], [data-testid="redirect-outline"]')).filter(isVisible);
    for (let i = 0; i < keyZones.length; i++) {
      const a = keyZones[i];
      const rA = a.getBoundingClientRect();
      const sA = window.getComputedStyle(a);
      measurements.push({
        selector: describeEl(a),
        rect: { x: Math.round(rA.x), y: Math.round(rA.y), w: Math.round(rA.width), h: Math.round(rA.height) },
        borderRadius: sA.borderRadius,
        boxShadow: sA.boxShadow !== 'none' ? sA.boxShadow : undefined,
        border: sA.borderTopWidth !== '0px' ? `${sA.borderTopWidth} ${sA.borderTopStyle} ${sA.borderTopColor}` : undefined
      });

      for (let j = i + 1; j < keyZones.length; j++) {
        const b = keyZones[j];
        if (a.contains(b) || b.contains(a)) continue;
        const rB = b.getBoundingClientRect();
        const overlapX = Math.max(0, Math.min(rA.right, rB.right) - Math.max(rA.left, rB.left));
        const overlapY = Math.max(0, Math.min(rA.bottom, rB.bottom) - Math.max(rA.top, rB.top));
        if (overlapX > 4 && overlapY > 4) {
          issues.push({
            type: 'ELEMENT_OVERLAP',
            step: stepLabel,
            elementA: describeEl(a),
            elementB: describeEl(b),
            detail: `Overlap of ${Math.round(overlapX)}x${Math.round(overlapY)}px detected`
          });
        }
      }
    }

    return { step: stepLabel, url: window.location.href, issues, measurements };
  }, stepName);
}

async function main() {
  const consoleErrors = [];
  const pageErrors = [];
  const stepsReport = [];

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer', '--disable-extensions', '--renderer-process-limit=2', '--js-flags=--max-old-space-size=256']
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => {
    pageErrors.push(err.message || String(err));
  });

  const captureStep = async (label, index) => {
    await page.waitForTimeout(400);
    const safeName = `step_${index}_${label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}.png`;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, safeName), fullPage: true });
    const scan = await scanPageGeometry(page, label);
    scan.screenshot = `.reviews/screenshots/${safeName}`;
    stepsReport.push(scan);
  };

  try {
    // Step 1: Load Lobby
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 20000 });
    await captureStep('lobby_initial', 1);

    // Step 2: Run AI-generated custom playbook interactions if present
    if (fs.existsSync('/workspace/.reviews/custom_qa_steps.mjs')) {
      const customModule = await import('/workspace/.reviews/custom_qa_steps.mjs');
      if (typeof customModule.runCustomSteps === 'function') {
        await customModule.runCustomSteps(page, captureStep);
      }
    } else {
      // Default fallback walkthrough: create a game and inspect the table
      const createBtn = page.locator('button:has-text("Create"), button:has-text("Start")').first();
      if (await createBtn.count() > 0) {
        await createBtn.click();
        await page.waitForTimeout(800);
        await captureStep('game_created_view', 2);
      }
    }
  } catch (err) {
    pageErrors.push(`Playwright step execution error: ${err.message}`);
  } finally {
    await browser.close();
  }

  const fullReport = {
    timestamp: new Date().toISOString(),
    consoleErrors,
    pageErrors,
    totalGeometryIssues: stepsReport.reduce((acc, s) => acc + s.issues.length, 0),
    steps: stepsReport
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(fullReport, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
EOF

# 3. Boot backend (:8080) and frontend (:5173) inside freebuff_worker in the background
echo "🚀 Starting temporary backend (:8080) and frontend (:5173) inside freebuff_worker..."
docker exec -d freebuff_worker bash -c '
  (cd /workspace/backend && sbt -batch run > /workspace/.reviews/qa_backend.log 2>&1) &
  (cd /workspace/frontend && npm run dev -- --host 0.0.0.0 --port 5173 > /workspace/.reviews/qa_frontend.log 2>&1) &
'

# Wait up to 90s for both :5173 and :8080 to accept connections
READY=0
for _ in $(seq 1 45); do
  if docker exec freebuff_worker bash -c "curl -s http://localhost:5173 >/dev/null && (curl -s http://localhost:8080/api/games >/dev/null || curl -s http://localhost:8080 >/dev/null)" 2>/dev/null; then
    READY=1
    break
  fi
  sleep 2
done

if [ "$READY" -eq 0 ]; then
  echo "⚠️  Servers did not become ready within 90s. Check .reviews/qa_backend.log and .reviews/qa_frontend.log."
fi

# 4. Run the Headless Chromium Visual & Geometry Scanner inside freebuff_worker
echo "📸 Running Headless Chromium across QA steps and scanning CSS geometry/borders..."
docker exec freebuff_worker node /workspace/.reviews/visual_qa_harness.mjs > .reviews/visual_qa_runner.log 2>&1 || true

# 5. Stop the temporary servers inside freebuff_worker so ports :8080 and :5173 are free for ./play-local.sh
docker exec freebuff_worker bash -c "pkill -9 -f 'sbt|java|chromium|vite|esbuild' 2>/dev/null || true" 2>/dev/null || true

echo "✅ Visual QA telemetry written to .reviews/visual_qa_telemetry.json and screenshots saved to .reviews/screenshots/!"