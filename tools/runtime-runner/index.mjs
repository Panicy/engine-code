import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function nowIso() {
  return new Date().toISOString();
}

function outputSummary(result, limit = 800) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  if (output) return output.slice(0, limit);
  return `exit ${result.status ?? 'unknown'}`;
}

function checkResult({ id, type, status, required, summary, command = '', target = '' }) {
  return { id, type, status, required, command, target, summary };
}

function runShell(command, cwd, timeoutMs) {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) {
    return { ok: false, summary: result.error.message };
  }
  return { ok: result.status === 0, summary: outputSummary(result) };
}

function runCommandItem(item, cwd, mode, phase, timeoutMs) {
  if (mode === 'mock') {
    return checkResult({
      id: item.id,
      type: phase,
      status: 'passed',
      required: item.required,
      command: item.command,
      summary: `mock ${phase} ${item.command}`,
    });
  }
  const result = runShell(item.command, cwd, timeoutMs);
  return checkResult({
    id: item.id,
    type: phase,
    status: result.ok ? 'passed' : 'failed',
    required: item.required,
    command: item.command,
    summary: result.summary,
  });
}

function runHttpCheck(item, cwd, mode, timeoutMs) {
  if (mode === 'mock') {
    return checkResult({
      id: item.id,
      type: 'health',
      status: 'passed',
      required: item.required,
      target: item.target,
      summary: `mock http ${item.target}`,
    });
  }
  const script = `
const input = JSON.parse(process.argv[1]);
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), input.timeoutMs);
try {
  const response = await fetch(input.url, { method: 'GET', signal: controller.signal });
  const text = await response.text();
  console.log(JSON.stringify({ ok: true, status: response.status, body: text.slice(0, 500) }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }));
} finally {
  clearTimeout(timer);
}
`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify({ url: item.target, timeoutMs })], {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs + 1000,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    return checkResult({
      id: item.id,
      type: 'health',
      status: 'failed',
      required: item.required,
      target: item.target,
      summary: outputSummary(result),
    });
  }
  try {
    const payload = JSON.parse(result.stdout);
    if (!payload.ok) {
      return checkResult({ id: item.id, type: 'health', status: 'failed', required: item.required, target: item.target, summary: payload.error });
    }
    const expected = item.expectedStatuses?.length ? item.expectedStatuses : [200];
    const matched = expected.includes(payload.status);
    return checkResult({
      id: item.id,
      type: 'health',
      status: matched ? 'passed' : 'failed',
      required: item.required,
      target: item.target,
      summary: matched ? `HTTP ${payload.status} matched expected ${expected.join(',')}` : `HTTP ${payload.status} expected ${expected.join(',')}; body=${payload.body}`,
    });
  } catch (error) {
    return checkResult({ id: item.id, type: 'health', status: 'failed', required: item.required, target: item.target, summary: `invalid http check output: ${error.message}` });
  }
}

async function runBrowserCheck(item, cwd, mode) {
  if (mode === 'mock') {
    return checkResult({
      id: item.id,
      type: 'browser',
      status: 'passed',
      required: item.required,
      target: item.url,
      summary: `mock browser ${item.url}`,
    });
  }
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (error) {
    return checkResult({
      id: item.id,
      type: 'browser',
      status: item.required ? 'failed' : 'skipped',
      required: item.required,
      target: item.url,
      summary: `playwright unavailable: ${error.message}`,
    });
  }
  const launchOptions = { headless: true };
  const chromePath = process.env.ENGINE_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(chromePath)) launchOptions.executablePath = chromePath;
  let browser;
  try {
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage();
    const messages = [];
    page.on('console', (message) => {
      if (message.type() === 'error') messages.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`));
    await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: Math.max(item.waitMs ?? 3000, 10000) });
    await page.waitForTimeout(item.waitMs ?? 3000);
    const hasErrors = messages.length > 0 && item.failOnConsoleError !== false;
    return checkResult({
      id: item.id,
      type: 'browser',
      status: hasErrors ? 'failed' : 'passed',
      required: item.required,
      target: item.url,
      summary: hasErrors ? messages.slice(0, 10).join('\n') : `browser opened ${item.url} without console errors`,
    });
  } catch (error) {
    return checkResult({ id: item.id, type: 'browser', status: 'failed', required: item.required, target: item.url, summary: error.message });
  } finally {
    if (browser) await browser.close();
  }
}

function requiredFailed(results) {
  return results.some((item) => item.required !== false && item.status === 'failed');
}

async function runRuntimeForBase({ project, base, template, mode = 'check', repoRoot = process.cwd(), timeoutMs = 120000 }) {
  const workspaceAbs = path.resolve(repoRoot, base.workspace);
  const profile = template.runtimeProfile ?? {};
  const startedAt = nowIso();
  const checks = [];

  for (const item of profile.preflightCommands ?? []) {
    checks.push(runCommandItem(item, workspaceAbs, mode, 'preflight', timeoutMs));
  }
  for (const item of profile.healthChecks ?? []) {
    if (item.type === 'command') {
      checks.push(runCommandItem({ id: item.id, command: item.target, required: item.required }, workspaceAbs, mode, 'health', timeoutMs));
    } else if (item.type === 'http') {
      checks.push(runHttpCheck(item, workspaceAbs, mode, timeoutMs));
    }
  }
  for (const item of profile.browserChecks ?? []) {
    checks.push(await runBrowserCheck(item, workspaceAbs, mode));
  }

  return {
    schemaVersion: '0.1.0',
    projectId: project.projectId,
    baseId: base.baseId,
    templateId: base.templateId,
    mode,
    startedAt,
    finishedAt: nowIso(),
    workspace: base.workspace,
    workspaceAbs,
    status: requiredFailed(checks) ? 'failed' : 'passed',
    startCommands: profile.startCommands ?? [],
    checks,
  };
}

async function runRuntimeProfiles({ project, templatesDir = '.engine/templates', baseIds = [], mode = 'check', repoRoot = process.cwd(), timeoutMs = 120000 }) {
  const selectedBaseIds = new Set(baseIds);
  const bases = (project.bases ?? []).filter((base) => selectedBaseIds.size === 0 || selectedBaseIds.has(base.baseId));
  const results = [];
  for (const base of bases) {
    const templatePath = path.resolve(repoRoot, templatesDir, base.templateId, 'template.json');
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    results.push(await runRuntimeForBase({ project, base, template, mode, repoRoot, timeoutMs }));
  }
  return results;
}

export { runRuntimeForBase, runRuntimeProfiles };
