import { spawnSync } from 'node:child_process';

const realModes = new Set(['real', 'command']);

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

function isRealMode(mode) {
  return realModes.has(mode);
}

function runShellCommand(command, options) {
  const result = spawnSync(command, {
    cwd: options.cwd,
    shell: true,
    encoding: 'utf8',
    timeout: options.timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  return {
    ok: result.status === 0,
    status: result.status,
    summary: output ? output.slice(0, 500) : `exit ${result.status ?? 'unknown'}`,
  };
}

function runCommandCheck(check, options) {
  if (options.mode === 'mock') {
    return passedCheck(check, `mock command ${check.command}`);
  }
  if (!isRealMode(options.mode)) {
    return skippedCheck(check, `${options.mode} mode skipped command check`);
  }
  const result = runShellCommand(check.command, options);
  if (result.ok) return passedCheck(check, result.summary);
  return failedCheck(check, result.summary);
}

function runManualCheck(check) {
  if (check.required) return skippedCheck(check, 'manual check requires human verification');
  return skippedCheck(check, 'optional manual check skipped');
}

function runHookCommands(commands, options, label) {
  const failures = [];
  for (const command of commands ?? []) {
    const result = runShellCommand(command, options);
    if (!result.ok) failures.push(`${label}: ${command}: ${result.summary}`);
  }
  return failures;
}

function withAuthHeaders(http) {
  const headers = { ...(http.headers ?? {}) };
  if (http.authMode !== 'authenticated') return { ok: true, headers, redactions: [] };

  const tokenEnv = http.tokenEnv;
  if (!tokenEnv) {
    return { ok: false, error: 'authenticated HTTP check requires tokenEnv' };
  }
  const token = process.env[tokenEnv];
  if (!token) {
    return { ok: false, error: `authenticated HTTP check token env ${tokenEnv} is missing` };
  }
  const authHeader = http.authHeader ?? 'Authorization';
  const authScheme = http.authScheme ?? 'Bearer';
  const authValue = authScheme ? `${authScheme} ${token}` : token;
  headers[authHeader] = authValue;
  return { ok: true, headers, redactions: [token, authValue] };
}

function normalizeStringList(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function redactText(text, redactions = []) {
  let output = String(text ?? '');
  for (const secret of redactions.filter(Boolean)) {
    output = output.split(secret).join('[REDACTED]');
  }
  return output;
}

function bodyPreview(body, limit = 300, redactions = []) {
  const text = body ?? '';
  const preview = text.length > limit ? `${text.slice(0, limit)}...<truncated>` : text;
  return redactText(preview, redactions);
}

function valueAtPath(value, path) {
  return String(path).split('.').reduce((current, part) => {
    if (current == null || typeof current !== 'object') return undefined;
    return current[part];
  }, value);
}

function assertExpectedBody(expectedBody, body) {
  if (!expectedBody) return [];
  const failures = [];
  for (const needle of normalizeStringList(expectedBody.contains)) {
    if (!String(body).includes(needle)) failures.push(`body does not contain ${JSON.stringify(needle)}`);
  }
  for (const needle of normalizeStringList(expectedBody.notContains)) {
    if (String(body).includes(needle)) failures.push(`body contains forbidden ${JSON.stringify(needle)}`);
  }
  const jsonFields = expectedBody.jsonFields ?? {};
  const jsonFieldEntries = Object.entries(jsonFields);
  if (jsonFieldEntries.length > 0) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      failures.push(`body is not valid JSON for jsonFields assertion: ${error.message}`);
      return failures;
    }
    for (const [fieldPath, expected] of jsonFieldEntries) {
      const actual = valueAtPath(parsed, fieldPath);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures.push(`jsonFields ${fieldPath} expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    }
  }
  return failures;
}

function runHttpRequest(http, options) {
  const auth = withAuthHeaders(http);
  if (!auth.ok) return { ok: false, error: auth.error };
  const script = `
const input = JSON.parse(process.argv[1]);
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
try {
  const headers = { ...(input.headers || {}) };
  const init = { method: input.method, headers, signal: controller.signal };
  if (input.body !== undefined) {
    if (typeof input.body === 'string') {
      init.body = input.body;
    } else {
      init.body = JSON.stringify(input.body);
      if (!headers['content-type'] && !headers['Content-Type']) headers['content-type'] = 'application/json';
    }
  }
  const response = await fetch(input.url, init);
  const text = await response.text();
  console.log(JSON.stringify({ ok: true, status: response.status, body: text.slice(0, 10000), bodyTruncated: text.length > 10000 }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }));
} finally {
  clearTimeout(timeout);
}
`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify({
    method: http.method,
    url: http.url,
    headers: auth.headers,
    body: http.body,
    timeoutMs: options.timeoutMs,
  })], {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs + 1000,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    return { ok: false, error: output || `node fetch exited ${result.status ?? 'unknown'}`, redactions: auth.redactions ?? [] };
  }
  try {
    return { ...JSON.parse(result.stdout), redactions: auth.redactions ?? [] };
  } catch (error) {
    return { ok: false, error: `invalid http runner output: ${error.message}`, redactions: auth.redactions ?? [] };
  }
}

function validateAuthDisabledEnvironment(http) {
  if (http.authMode !== 'auth_disabled') return null;
  const environment = http.environment ?? 'unknown';
  if (environment === 'dev' || environment === 'test') return null;
  return `auth_disabled HTTP check is only allowed in dev/test environment; got ${environment}`;
}

function runHttpCheck(check, options) {
  if (!isRealMode(options.mode)) {
    return passedCheck(check, `mock http ${check.http.method} ${check.http.url} expected ${check.http.expectedStatus}`);
  }
  const authDisabledError = validateAuthDisabledEnvironment(check.http);
  if (authDisabledError) return failedCheck(check, authDisabledError);

  const setupFailures = runHookCommands(check.http.setupCommands, options, 'setup');
  let requestResult = null;
  try {
    if (setupFailures.length > 0) return failedCheck(check, setupFailures.join('\n'));
    requestResult = runHttpRequest(check.http, options);
  } finally {
    const teardownFailures = runHookCommands(check.http.teardownCommands, options, 'teardown');
    if (teardownFailures.length > 0) {
      return failedCheck(check, `${teardownFailures.join('\n')}\nrequires human: teardown failed while restoring check state`);
    }
  }
  if (!requestResult?.ok) {
    return failedCheck(check, redactText(requestResult?.error ?? 'http request failed', requestResult?.redactions ?? []));
  }
  const expected = check.http.expectedStatus;
  if (requestResult.status !== expected) {
    return failedCheck(check, `HTTP ${requestResult.status} expected ${expected}; body=${bodyPreview(requestResult.body, 300, requestResult.redactions)}`);
  }
  const bodyFailures = assertExpectedBody(check.http.expectedBody, requestResult.body ?? '');
  if (bodyFailures.length > 0) {
    return failedCheck(check, `HTTP ${requestResult.status} matched expected ${expected}; ${redactText(bodyFailures.join('; '), requestResult.redactions)}; body=${bodyPreview(requestResult.body, 300, requestResult.redactions)}`);
  }
  return passedCheck(check, `HTTP ${requestResult.status} matched expected ${expected}`);
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
    mode: options.mode ?? 'real',
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
