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

function normalizePathForReview(filePath) {
  return String(filePath ?? '').replaceAll('\\', '/').replace(/^\.\/+/, '');
}

function allowedPathMatches(changedFile, allowedPath) {
  const filePath = normalizePathForReview(changedFile);
  const rule = normalizePathForReview(allowedPath);
  if (!filePath || !rule) return false;
  if (rule.endsWith('/**')) {
    const dir = rule.slice(0, -3);
    return filePath === dir || filePath.startsWith(`${dir}/`);
  }
  if (rule.endsWith('/')) return filePath.startsWith(rule);
  return filePath === rule;
}

function latestAttemptChangedFiles(taskRun) {
  const attempts = taskRun?.attempts ?? [];
  const latest = attempts.reduce((current, attempt) => {
    if (!current) return attempt;
    return attempt.attempt > current.attempt ? attempt : current;
  }, null);
  return latest?.changedFiles ?? [];
}

function reviewScope(taskContext, taskRun) {
  const changedFiles = latestAttemptChangedFiles(taskRun).map(normalizePathForReview).filter(Boolean);
  if (changedFiles.length === 0) return [];
  const allowedPaths = taskContext.executionHints?.allowedPaths ?? taskContext.task.allowedPaths ?? [];
  const findings = [];
  for (const changedFile of changedFiles) {
    if (allowedPaths.some((allowedPath) => allowedPathMatches(changedFile, allowedPath))) continue;
    findings.push({
      severity: 'high',
      description: `文件 ${changedFile} 不在 allowedPaths 允许范围内。允许范围：${allowedPaths.length > 0 ? allowedPaths.join(', ') : '(空)'}`,
      file: changedFile,
      line: null,
    });
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

function runReview({ runState, taskContext, outcome, reviewedAt, taskRun }) {
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
  const scopeFindings = reviewScope(taskContext, taskRun);
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
