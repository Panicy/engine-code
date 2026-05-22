import path from 'node:path';

function toPosixPath(filePath) {
  return filePath.replace(/\\/g, '/').split(path.sep).join('/');
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(pattern) {
  const normalized = toPosixPath(pattern);
  let source = '';
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === '*' && next === '*') {
      source += '.*';
      i += 1;
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    source += escapeRegex(char);
  }
  return new RegExp(`^${source}$`);
}

function normalizeChangedFile(filePath, baseWorkspace) {
  if (!filePath) return '';
  if (path.isAbsolute(filePath)) {
    const relative = path.relative(baseWorkspace, filePath);
    return toPosixPath(relative);
  }
  return toPosixPath(filePath);
}

function matchesAnyPattern(filePath, patterns) {
  return patterns.some((pattern) => globToRegex(pattern).test(filePath));
}

function reviewChangedFiles(taskContext, changedFiles) {
  const allowedPaths = taskContext.executionHints.allowedPaths ?? [];
  const baseWorkspace = taskContext.base.workspaceAbs;
  const findings = [];
  for (const file of changedFiles ?? []) {
    const normalized = normalizeChangedFile(file, baseWorkspace);
    if (normalized.startsWith('../') || normalized === '..') {
      findings.push({
        severity: 'high',
        description: `改动文件位于 base workspace 外：${file}`,
        file,
        line: null,
      });
      continue;
    }
    if (allowedPaths.length > 0 && !matchesAnyPattern(normalized, allowedPaths)) {
      findings.push({
        severity: 'high',
        description: `改动文件不在 task.allowedPaths 内：${normalized}`,
        file: normalized,
        line: null,
      });
    }
  }
  return findings;
}

function reviewChecks(taskContext, checks) {
  const requiredById = new Map((taskContext.executionHints.checks ?? []).map((check) => [check.id, check.required !== false]));
  const findings = [];
  for (const check of checks ?? []) {
    if (requiredById.get(check.id) !== true) continue;
    if (check.status !== 'passed') {
      findings.push({
        severity: 'high',
        description: `必需检查未通过：${check.id} (${check.status})`,
        file: null,
        line: null,
      });
    }
  }
  const requiredCheckIds = [...requiredById.entries()].filter(([, required]) => required).map(([id]) => id);
  const presentIds = new Set((checks ?? []).map((check) => check.id));
  for (const checkId of requiredCheckIds) {
    if (!presentIds.has(checkId)) {
      findings.push({
        severity: 'medium',
        description: `缺少必需检查结果：${checkId}`,
        file: null,
        line: null,
      });
    }
  }
  return findings;
}

function criteriaResults(taskContext, findings) {
  const criteria = taskContext.task.acceptanceCriteria ?? [{ id: 'AC-001', text: taskContext.task.title }];
  const status = findings.some((finding) => finding.severity === 'high') ? 'fail' : findings.length > 0 ? 'unclear' : 'pass';
  const evidence = status === 'pass'
    ? 'adapter 执行完成，必需 checks 已通过，未发现确定性 review 问题。'
    : 'Review Runner 发现确定性问题，需修复后重跑。';
  return criteria.map((criterion) => ({
    criterionId: criterion.id,
    status,
    evidence,
  }));
}

function runReview({ runState, taskContext, outcome, reviewedAt }) {
  if (outcome.reviewVerdict === 'fail' || outcome.reviewVerdict === 'needs_human') {
    const verdict = outcome.reviewVerdict;
    const finding = {
      severity: 'high',
      description: outcome.summary || `adapter requested review verdict ${verdict}`,
      file: null,
      line: null,
    };
    return {
      schemaVersion: '0.1.0',
      runId: runState.runId,
      taskId: taskContext.task.id,
      verdict,
      reviewedAt,
      criteriaResults: criteriaResults(taskContext, [finding]),
      scopeFindings: [],
      architectureFindings: [finding],
      testFindings: [],
      requiredFixes: [{ id: 'FIX-001', description: finding.description }],
      suggestedFollowUpTasks: [],
      summary: outcome.summary || `Review Runner received adapter verdict ${verdict} for ${taskContext.task.id}`,
    };
  }
  const scopeFindings = reviewChangedFiles(taskContext, outcome.changedFiles ?? []);
  const testFindings = reviewChecks(taskContext, outcome.checks ?? []);
  const architectureFindings = [];
  const findings = [...scopeFindings, ...testFindings, ...architectureFindings];
  const hardFailures = findings.filter((finding) => finding.severity === 'high');
  const verdict = hardFailures.length > 0 ? 'fail' : 'pass';
  const requiredFixes = findings.map((finding, index) => ({
    id: `FIX-${String(index + 1).padStart(3, '0')}`,
    description: finding.description,
  }));
  return {
    schemaVersion: '0.1.0',
    runId: runState.runId,
    taskId: taskContext.task.id,
    verdict,
    reviewedAt,
    criteriaResults: criteriaResults(taskContext, findings),
    scopeFindings,
    architectureFindings,
    testFindings,
    requiredFixes,
    suggestedFollowUpTasks: [],
    summary: verdict === 'pass'
      ? `Review Runner passed ${taskContext.task.id}`
      : `Review Runner found ${findings.length} issue(s) for ${taskContext.task.id}`,
  };
}

export { runReview };
