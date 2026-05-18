import { spawnSync } from 'node:child_process';

function checkCommand(check) {
  if (check.command) return check.command;
  if (check.http) return `${check.http.method} ${check.http.url} -> ${check.http.expectedStatus}`;
  if (check.manual) return `manual: ${check.manual.instruction}`;
  return check.type;
}

function skippedCheck(check, summary) {
  return {
    id: check.id,
    command: checkCommand(check),
    status: 'skipped',
    summary,
  };
}

function passedCheck(check, summary) {
  return {
    id: check.id,
    command: checkCommand(check),
    status: 'passed',
    summary,
  };
}

function failedCheck(check, summary) {
  return {
    id: check.id,
    command: checkCommand(check),
    status: 'failed',
    summary,
  };
}

function runCommandCheck(check, options) {
  if (options.mode !== 'command') {
    return skippedCheck(check, `${options.mode} mode skipped command check`);
  }
  const result = spawnSync(check.command, {
    cwd: options.cwd,
    shell: true,
    encoding: 'utf8',
    timeout: options.timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  const summary = output ? output.slice(0, 500) : `exit ${result.status ?? 'unknown'}`;
  if (result.status === 0) return passedCheck(check, summary);
  return failedCheck(check, summary);
}

function runManualCheck(check) {
  if (check.required) return skippedCheck(check, 'manual check requires human verification');
  return skippedCheck(check, 'optional manual check skipped');
}

function runHttpCheck(check, options) {
  if (options.mode !== 'mock') {
    return skippedCheck(check, `${options.mode} mode does not execute http checks yet`);
  }
  return passedCheck(check, `mock http ${check.http.method} ${check.http.url} expected ${check.http.expectedStatus}`);
}

function runSingleCheck(check, options) {
  if (options.mockFailCheckId && options.mockFailCheckId === check.id) {
    return failedCheck(check, `mock check failed by --mock-fail-check ${check.id}`);
  }
  if (check.type === 'manual') return runManualCheck(check);
  if (check.type === 'http') return runHttpCheck(check, options);
  if (check.command) return runCommandCheck(check, options);
  return skippedCheck(check, `check type ${check.type} has no executable runner`);
}

function runChecks(task, options = {}) {
  const runnerOptions = {
    mode: options.mode ?? 'mock',
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 120000,
    mockFailCheckId: options.mockFailCheckId ?? '',
  };
  const checks = (task.checks ?? []).map((check) => runSingleCheck(check, runnerOptions));
  const requiredFailures = checks.filter((check) => check.status === 'failed' && (task.checks ?? []).find((item) => item.id === check.id)?.required !== false);
  const requiredManual = checks.filter((check) => check.status === 'skipped' && (task.checks ?? []).find((item) => item.id === check.id)?.type === 'manual' && (task.checks ?? []).find((item) => item.id === check.id)?.required === true);
  return {
    status: requiredFailures.length > 0 || requiredManual.length > 0 ? 'checks_failed' : 'passed',
    checks,
    failedCheckIds: requiredFailures.map((check) => check.id),
    manualCheckIds: requiredManual.map((check) => check.id),
  };
}

export { checkCommand, runChecks };
