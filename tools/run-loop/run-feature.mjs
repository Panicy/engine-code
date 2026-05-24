#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateFiles, validateSchema } from '../validator/validate-feature.mjs';
import { availableAgentAdapters, createAgentAdapter } from '../agent-adapters/index.mjs';
import { runChecks } from '../checks-runner/index.mjs';
import { buildTaskContext } from '../skill-context/index.mjs';
import { runReview } from '../review-runner/index.mjs';
import { runRuntimeProfiles } from '../runtime-runner/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

function usage() {
  return [
    '用法：node tools/run-loop/run-feature.mjs \\',
    '  --project <project.json> \\',
    '  --prd <prd.json> \\',
    '  --task-plan <task-plan.json> \\',
    '  --run-state <run-state.json>',
    '',
    '可选：',
    '  --templates-dir .engine/templates',
    `  --agent-adapter ${availableAgentAdapters().join('|')}`,
    '  --checks-mode real|mock|command',
    '  --runtime-mode skip|mock|check',
    '  --max-tasks 0',
    '  --allow-empty-changes true|false',
    '  --mock-fail-task TASK-001',
    '  --mock-fail-stage check|review|human',
    '  --mock-fail-check CHECK-001',
    '  --shell-command <command>',
    '  --shell-timeout-ms 300000',
    '  --codex-command codex',
    '  --codex-model <model>',
    '  --codex-timeout-ms 300000',
    '  --codex-extra-arg <arg>',
    '  --external-agent-command <command>',
    '  --external-agent-timeout-ms 300000',
    '  --external-agent-extra-arg <arg>',
    '  --owner run-loop',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  const allowedKeys = new Set([
    'project',
    'prd',
    'task-plan',
    'run-state',
    'templates-dir',
    'agent-adapter',
    'checks-mode',
    'runtime-mode',
    'max-tasks',
    'allow-empty-changes',
    'mock-fail-task',
    'mock-fail-stage',
    'mock-fail-check',
    'shell-command',
    'shell-timeout-ms',
    'codex-command',
    'codex-model',
    'codex-timeout-ms',
    'codex-extra-arg',
    'external-agent-command',
    'external-agent-timeout-ms',
    'external-agent-extra-arg',
    'owner',
  ]);
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    const key = arg.slice(2);
    if (!allowedKeys.has(key)) throw new Error(`未知参数：${arg}`);
    const value = argv[i + 1];
    if (!value || (!['codex-extra-arg', 'external-agent-extra-arg'].includes(key) && value.startsWith('--'))) throw new Error(`参数 ${arg} 缺少值`);
    if (['codex-extra-arg', 'external-agent-extra-arg'].includes(key)) {
      args[key] = [...(args[key] ?? []), value];
    } else {
      args[key] = value;
    }
    i += 1;
  }
  return args;
}

function requireArg(args, key) {
  if (!args[key]) throw new Error(`缺少必填参数 --${key}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(repoRoot, filePath), 'utf8'));
}

function readJsonIfExists(filePath) {
  const abs = path.resolve(repoRoot, filePath);
  if (!fs.existsSync(abs)) return null;
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function readSchema(name) {
  return readJson(`schemas/${name}.schema.json`);
}

function writeJsonAtomic(filePath, value) {
  const abs = path.resolve(repoRoot, filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, abs);
  return abs;
}

function nowIso() {
  return new Date().toISOString();
}

function runGit(workspaceAbs, args) {
  return spawnSync('git', args, {
    cwd: workspaceAbs,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
}

function assertGitWorkspace(workspaceAbs) {
  const result = runGit(workspaceAbs, ['rev-parse', '--is-inside-work-tree']);
  if (result.error || result.status !== 0 || result.stdout.trim() !== 'true') {
    const detail = [result.error?.message, result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`base workspace 不是 git 仓库：${workspaceAbs}${detail ? ` (${detail})` : ''}`);
  }
}

function fileFingerprint(workspaceAbs, filePath) {
  const abs = path.resolve(workspaceAbs, filePath);
  const relative = path.relative(workspaceAbs, abs);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return '';
  }
  return crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex');
}

function parseGitStatusPorcelainZ(output, workspaceAbs) {
  const entries = output.split('\0').filter(Boolean);
  const files = new Map();
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const filePath = entry.slice(3);
    if (!filePath) continue;
    if (status[0] === 'R' || status[1] === 'R' || status[0] === 'C' || status[1] === 'C') {
      files.set(filePath, `${status}:${fileFingerprint(workspaceAbs, filePath)}`);
      if (entries[i + 1]) i += 1;
      continue;
    }
    files.set(filePath, `${status}:${fileFingerprint(workspaceAbs, filePath)}`);
  }
  return files;
}

function collectGitDiffSnapshot(workspaceAbs) {
  assertGitWorkspace(workspaceAbs);
  const result = runGit(workspaceAbs, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`采集 git diff 失败：${workspaceAbs}${detail ? ` (${detail})` : ''}`);
  }
  return parseGitStatusPorcelainZ(result.stdout, workspaceAbs);
}

function changedFilesBetweenSnapshots(before, after) {
  return [...after.entries()]
    .filter(([filePath, status]) => before.get(filePath) !== status)
    .map(([filePath]) => filePath)
    .sort();
}

function addMinutesIso(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function isExpiredIso(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function flattenTasks(taskPlan) {
  return taskPlan.storyGroups.flatMap((group) => group.tasks.map((task) => ({ ...task, storyId: group.storyId, storyTitle: group.title })));
}

function baseIdsForRunnableTasks(taskPlan) {
  return [...new Set(flattenTasks(taskPlan).map((task) => task.targetBaseId))];
}

function taskMap(taskPlan) {
  return new Map(flattenTasks(taskPlan).map((task) => [task.id, task]));
}

function validateOrThrow(report, label) {
  if (!report.valid) {
    throw new Error(`${label} 校验失败：\n${JSON.stringify(report, null, 2)}`);
  }
}

function acquireLock(runState, owner, startedAt = nowIso()) {
  const existing = runState.activeRunLock;
  if (existing && Date.parse(existing.expiresAt) > Date.now()) {
    throw new Error(`Run Loop 已被 ${existing.owner} 锁定，expiresAt=${existing.expiresAt}`);
  }
  const timestamp = startedAt;
  runState.activeRunLock = {
    lockId: `LOCK-${Date.now()}`,
    owner,
    acquiredAt: timestamp,
    heartbeatAt: timestamp,
    expiresAt: addMinutesIso(30),
  };
  runState.status = 'running';
  if (!runState.startedAt) runState.startedAt = timestamp;
  runState.updatedAt = timestamp;
}

function recoverStaleRunningTasks(runState) {
  const existing = runState.activeRunLock;
  const hasRunningTask = Object.values(runState.taskStates ?? {}).some((state) => state.status === 'running');
  if (!hasRunningTask) return [];
  const canRecover = !existing || isExpiredIso(existing.expiresAt);
  if (!canRecover) return [];
  const recoveredAt = nowIso();
  const recoveredTaskIds = [];
  for (const [taskId, state] of Object.entries(runState.taskStates ?? {})) {
    if (state.status !== 'running') continue;
    recoveredTaskIds.push(taskId);
    state.status = 'needs_human';
    state.lastIssue = {
      type: 'stale_running_task',
      summary: `${taskId} 上一次 Run Loop 停留在 running，且运行锁已失效或不存在；引擎已停止猜测并转为 needs_human。`,
      source: 'orchestrator',
      requiredDecision: '请检查该 task 的真实代码改动和运行产物，确认后使用 sk retry 恢复重跑。',
      createdAt: recoveredAt,
    };
    state.updatedAt = recoveredAt;
  }
  runState.currentTaskId = null;
  runState.activeRunLock = null;
  runState.status = 'failed';
  runState.updatedAt = recoveredAt;
  return recoveredTaskIds;
}

function releaseLock(runState) {
  runState.activeRunLock = null;
  runState.currentTaskId = null;
  runState.updatedAt = nowIso();
}

function recomputeRunStatus(runState) {
  const hasException = Object.values(runState.taskStates).some((state) => ['checks_failed', 'review_failed', 'needs_human'].includes(state.status));
  const hasUnfinished = Object.values(runState.taskStates).some((state) => !['done', 'cancelled'].includes(state.status));
  return hasException ? 'failed' : hasUnfinished ? 'paused' : 'complete';
}

function normalizeDanglingRunningStatus(runState) {
  const hasRunningTask = Object.values(runState.taskStates ?? {}).some((state) => state.status === 'running');
  if (runState.status !== 'running' || runState.activeRunLock || hasRunningTask) return false;
  runState.status = recomputeRunStatus(runState);
  runState.currentTaskId = null;
  runState.updatedAt = nowIso();
  return true;
}

function promotePending(runState, tasksById) {
  let changed = false;
  for (const [taskId, state] of Object.entries(runState.taskStates)) {
    if (state.status !== 'pending') continue;
    const task = tasksById.get(taskId);
    if (!task) continue;
    const depsDone = task.dependsOn.every((depId) => runState.taskStates[depId]?.status === 'done');
    if (depsDone) {
      state.status = 'ready';
      state.updatedAt = nowIso();
      changed = true;
    }
  }
  return changed;
}

function findNextRunnable(taskPlan, runState, executedThisLoop) {
  for (const task of flattenTasks(taskPlan)) {
    if (executedThisLoop.has(task.id)) continue;
    const state = runState.taskStates[task.id];
    if (!state) continue;
    if (['ready', 'checks_failed', 'review_failed'].includes(state.status)) return task;
  }
  return null;
}

function mergeTaskRun(existing, next) {
  if (!existing) return next;
  const byAttempt = new Map();
  for (const attempt of existing.attempts ?? []) byAttempt.set(attempt.attempt, attempt);
  for (const attempt of next.attempts ?? []) byAttempt.set(attempt.attempt, attempt);
  return {
    ...next,
    attempts: [...byAttempt.values()].sort((a, b) => a.attempt - b.attempt),
  };
}

function buildPromptInputs({ task, args, taskContext, taskContextPath }) {
  return [
    { type: 'prd', path: args.prd },
    { type: 'taskPlan', path: args['task-plan'] },
    { type: 'runState', path: args['run-state'] },
    { type: 'task', path: `${args['task-plan']}#${task.id}` },
    { type: 'skill', path: taskContext.skill.documentPath },
    { type: 'skillContext', path: taskContextPath },
  ];
}

function buildTaskRun({ runState, task, attempt, status, startedAt, finishedAt, lastIssue, args, outcome, taskContext, taskContextPath, changedFiles }) {
  const item = {
    attempt,
    status,
    agent: outcome.agent,
    startedAt,
    finishedAt,
    promptInputs: buildPromptInputs({ task, args, taskContext, taskContextPath }),
    skillContext: {
      path: taskContextPath,
      skillId: taskContext.skill.id,
      skillDocumentPath: taskContext.skill.documentPath,
      skillDocumentSha256: taskContext.skill.documentSha256,
      enforced: true,
    },
    changedFiles: changedFiles ?? [],
    checks: outcome.checks ?? [],
    summary: outcome.summary ?? '',
    logs: outcome.logs ?? [],
    errors: outcome.errors ?? [],
    nextActions: outcome.nextActions ?? [],
  };
  if (lastIssue) item.lastIssue = lastIssue;
  return {
    schemaVersion: '0.1.0',
    runId: runState.runId,
    taskId: task.id,
    attempts: [item],
  };
}

function orchestratorFailureOutcome(error) {
  return {
    requestedStatus: 'needs_human',
    taskRunStatus: 'needs_human',
    reviewVerdict: null,
    source: 'orchestrator',
    agent: { tool: 'run-loop', model: 'orchestrator' },
    changedFiles: [],
    checks: [],
    summary: `Run Loop orchestrator error: ${error.message}`,
    errors: [error.message],
    nextActions: ['检查 orchestrator 错误、运行产物和当前 diff 后再恢复任务。'],
  };
}

function validateAdapterOutcome(outcome, adapterId) {
  const requestedStatuses = new Set(['done', 'checks_failed', 'review_failed', 'needs_human']);
  const taskRunStatuses = new Set(['passed', 'checks_failed', 'review_failed', 'needs_human']);
  const reviewVerdicts = new Set(['pass', 'fail', 'needs_human', null, undefined]);
  const sources = new Set(['executor', 'check', 'reviewer', 'orchestrator']);
  if (!outcome || typeof outcome !== 'object') {
    throw new Error(`${adapterId} adapter 返回值必须是对象。`);
  }
  if (!requestedStatuses.has(outcome.requestedStatus)) {
    throw new Error(`${adapterId} adapter requestedStatus 非法：${outcome.requestedStatus}`);
  }
  if (!taskRunStatuses.has(outcome.taskRunStatus)) {
    throw new Error(`${adapterId} adapter taskRunStatus 非法：${outcome.taskRunStatus}`);
  }
  if (!reviewVerdicts.has(outcome.reviewVerdict)) {
    throw new Error(`${adapterId} adapter reviewVerdict 非法：${outcome.reviewVerdict}`);
  }
  if (!sources.has(outcome.source)) {
    throw new Error(`${adapterId} adapter source 非法：${outcome.source}`);
  }
  if (!outcome.agent?.tool || !outcome.agent?.model) {
    throw new Error(`${adapterId} adapter 必须返回 agent.tool 和 agent.model。`);
  }
}

function outputSummary(result, limit = 1000) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  return output ? output.slice(0, limit) : `exit ${result.status ?? 'unknown'}`;
}

function runTaskPreflight(taskContext, timeoutMs = 60000) {
  const commands = taskContext.template.taskPreflightCommands ?? [];
  const checks = [];
  for (const item of commands) {
    const result = spawnSync(item.command, {
      cwd: taskContext.base.workspaceAbs,
      shell: true,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    const failed = Boolean(result.error) || result.status !== 0;
    checks.push({
      id: item.id,
      command: item.command,
      status: failed ? 'failed' : 'passed',
      summary: failed
        ? `${item.description ?? 'task preflight failed'}\n${result.error ? result.error.message : outputSummary(result)}`
        : item.description ?? `task preflight passed: ${item.command}`,
    });
  }
  const failedChecks = checks.filter((check) => check.status === 'failed');
  if (failedChecks.length === 0) return { passed: true, checks };
  const installCommands = taskContext.template.installCommands ?? [];
  return {
    passed: false,
    checks,
    outcome: {
      requestedStatus: 'needs_human',
      taskRunStatus: 'needs_human',
      reviewVerdict: null,
      source: 'orchestrator',
      agent: { tool: 'run-loop', model: 'task-preflight' },
      changedFiles: [],
      checks,
      summary: `task preflight failed: ${failedChecks.map((check) => check.id).join(', ')}`,
      logs: [],
      errors: failedChecks.map((check) => check.summary),
      nextActions: installCommands.length > 0
        ? installCommands.map((command) => `在 ${taskContext.base.workspaceAbs} 执行：${command}`)
        : ['修复模板 taskPreflightCommands 报告的问题后重跑。'],
    },
  };
}

function recordOutcomeArtifacts(runState, outcome) {
  for (const log of outcome.logs ?? []) {
    if (!log?.path) continue;
    if (!runState.artifacts.some((artifact) => artifact.type === 'log' && artifact.path === log.path)) {
      runState.artifacts.push({ type: 'log', path: log.path });
    }
  }
}

function retryAwareStatus(state, desiredStatus) {
  if ((desiredStatus === 'checks_failed' || desiredStatus === 'review_failed') && state.maxAttempts && state.attempts >= state.maxAttempts) {
    return 'needs_human';
  }
  return desiredStatus;
}

function normalizeOutcomeWithChecks({ outcome, checkResult }) {
  if (outcome.requestedStatus !== 'done') {
    return {
      ...outcome,
      checks: checkResult.checks,
    };
  }
  if (checkResult.status === 'passed') {
    return {
      ...outcome,
      checks: checkResult.checks,
    };
  }
  return {
    ...outcome,
    requestedStatus: 'checks_failed',
    taskRunStatus: 'checks_failed',
    reviewVerdict: null,
    source: 'check',
    checks: checkResult.checks,
    summary: `checks failed: ${[...checkResult.failedCheckIds, ...checkResult.manualCheckIds].join(', ')}`,
    nextActions: ['修复检查失败项后下一轮自动重试。'],
  };
}

function normalizeOutcomeWithReview({ outcome, review }) {
  if (outcome.requestedStatus !== 'done') return outcome;
  if (review.verdict === 'pass') return outcome;
  return {
    ...outcome,
    requestedStatus: review.verdict === 'needs_human' ? 'needs_human' : 'review_failed',
    taskRunStatus: review.verdict === 'needs_human' ? 'needs_human' : 'review_failed',
    reviewVerdict: review.verdict,
    source: 'reviewer',
    summary: review.summary,
    nextActions: review.requiredFixes.map((fix) => fix.description),
  };
}

function normalizeOutcomeWithChangedFiles({ outcome, adapterId, changedFiles, args }) {
  if (outcome.requestedStatus !== 'done') return outcome;
  if (adapterId === 'mock') return outcome;
  if (args['allow-empty-changes'] === 'true') return outcome;
  if (changedFiles.length > 0) return outcome;
  return {
    ...outcome,
    requestedStatus: 'needs_human',
    taskRunStatus: 'needs_human',
    reviewVerdict: null,
    source: 'executor',
    summary: `${adapterId} agent completed without file changes; refusing to mark task done.`,
    errors: [...(outcome.errors ?? []), `${adapterId} agent produced no file changes`],
    nextActions: [
      '确认 agent 是否只是解释而未开发。',
      '使用可写 sandbox 重跑当前 task。',
      '如果该 task 本来就不需要改文件，请显式使用 --allow-empty-changes true。',
    ],
  };
}

function artifactPath(featureDir, taskId, fileName) {
  return path.join(featureDir, 'runs', taskId, fileName);
}

function schemaValidateArtifact(name, value, file) {
  const schema = readSchema(name);
  const errors = validateSchema(value, schema, { file, rootSchema: schema });
  if (errors.length > 0) throw new Error(`${file} 不符合 ${name}.schema.json：\n${JSON.stringify(errors, null, 2)}`);
}

function summarize(runState) {
  const taskSummary = { done: [], pending: [], checksFailed: [], reviewFailed: [], needsHuman: [], cancelled: [] };
  for (const [taskId, state] of Object.entries(runState.taskStates)) {
    if (state.status === 'done') taskSummary.done.push(taskId);
    if (state.status === 'pending' || state.status === 'ready' || state.status === 'running') taskSummary.pending.push(taskId);
    if (state.status === 'checks_failed') taskSummary.checksFailed.push(taskId);
    if (state.status === 'review_failed') taskSummary.reviewFailed.push(taskId);
    if (state.status === 'needs_human') taskSummary.needsHuman.push(taskId);
    if (state.status === 'cancelled') taskSummary.cancelled.push(taskId);
  }
  return taskSummary;
}

function buildLoopSummary({ runState, taskPlan, startedAt, finishedAt, executedTaskIds, featureDir }) {
  const taskSummary = summarize(runState);
  const abnormalTasks = [];
  const issues = [];
  const tasksById = taskMap(taskPlan);
  for (const [taskId, state] of Object.entries(runState.taskStates)) {
    if (!['checks_failed', 'review_failed', 'needs_human'].includes(state.status)) continue;
    const artifact = artifactPath(featureDir, taskId, 'task-run.json');
    const source = state.lastIssue?.source ?? 'orchestrator';
    const summary = state.lastIssue?.summary ?? `${taskId} ${state.status}`;
    issues.push({
      taskId,
      status: state.status,
      summary,
      requiredDecision: state.lastIssue?.requiredDecision ?? '',
      artifactPath: artifact,
    });
    abnormalTasks.push({
      taskId,
      status: state.status,
      source,
      summary,
      attempts: state.attempts,
      maxAttempts: state.maxAttempts ?? tasksById.get(taskId)?.retryPolicy?.maxAttempts ?? 1,
      retryExhausted: Boolean(state.maxAttempts && state.attempts >= state.maxAttempts),
      requiredDecision: state.lastIssue?.requiredDecision ?? '',
      nextAction: state.status === 'needs_human' ? '等待人工处理。' : '下一轮可自动重跑。',
      artifactPath: artifact,
    });
  }
  const nextRunnableTaskIds = Object.entries(runState.taskStates)
    .filter(([, state]) => ['ready', 'checks_failed', 'review_failed'].includes(state.status))
    .map(([taskId]) => taskId);
  const hasUnfinished = Object.values(runState.taskStates).some((state) => !['done', 'cancelled'].includes(state.status));
  return {
    schemaVersion: '0.1.0',
    runId: runState.runId,
    planId: runState.planId,
    startedAt,
    finishedAt,
    status: abnormalTasks.length > 0 || hasUnfinished ? 'has_exceptions' : 'complete',
    taskSummary,
    issues,
    abnormalTasks,
    nextRunnableTaskIds,
  };
}

async function runRuntimePreflight({ args, project, taskPlan, runState, templatesDir, featureDir }) {
  const runtimeMode = args['runtime-mode'] ?? 'skip';
  if (!['skip', 'mock', 'check'].includes(runtimeMode)) {
    throw new Error('--runtime-mode 必须是 skip、mock 或 check。');
  }
  if (runtimeMode === 'skip') return [];
  const runtimeDir = path.join(featureDir, 'runs', 'runtime');
  const results = await runRuntimeProfiles({
    project,
    templatesDir,
    baseIds: baseIdsForRunnableTasks(taskPlan),
    mode: runtimeMode,
    repoRoot,
  });
  for (const result of results) {
    const runtimePath = path.join(runtimeDir, `${result.baseId}-runtime.json`);
    writeJsonAtomic(runtimePath, result);
    if (!runState.artifacts.some((artifact) => artifact.type === 'runtime' && artifact.path === runtimePath)) {
      runState.artifacts.push({ type: 'runtime', path: runtimePath });
    }
  }
  const failed = results.filter((result) => result.status !== 'passed');
  if (failed.length > 0) {
    throw new Error(`Runtime Profile 检查失败：${failed.map((item) => `${item.baseId}=${item.status}`).join(', ')}`);
  }
  return results;
}

async function runLoop(args) {
  requireArg(args, 'project');
  requireArg(args, 'prd');
  requireArg(args, 'task-plan');
  requireArg(args, 'run-state');
  const startedAt = nowIso();
  const templatesDir = args['templates-dir'] ?? '.engine/templates';
  const adapter = createAgentAdapter(args['agent-adapter'] ?? 'mock');
  const checksMode = args['checks-mode'] ?? 'real';
  if (!['real', 'mock', 'command'].includes(checksMode)) {
    throw new Error('--checks-mode 必须是 real、mock 或 command。');
  }
  const owner = args.owner ?? 'run-loop';
  const maxTasksRaw = args['max-tasks'] ?? '0';
  const maxTasks = /^\d+$/.test(maxTasksRaw) ? Number.parseInt(maxTasksRaw, 10) : Number.NaN;
  if (!Number.isInteger(maxTasks) || maxTasks < 0) {
    throw new Error('--max-tasks 必须是非负整数，0 表示尽量跑完所有可运行任务。');
  }
  const featureDir = path.dirname(args['task-plan']);
  const project = readJson(args.project);
  const prd = readJson(args.prd);
  const taskPlan = readJson(args['task-plan']);
  const runState = readJson(args['run-state']);
  const tasksById = taskMap(taskPlan);
  const preReport = validateFiles({
    project: args.project,
    prd: args.prd,
    'task-plan': args['task-plan'],
    'run-state': args['run-state'],
    'templates-dir': templatesDir,
  });
  validateOrThrow(preReport, 'Run Loop 前置 Validator');
  const recoveredTaskIds = recoverStaleRunningTasks(runState);
  const normalizedDanglingStatus = normalizeDanglingRunningStatus(runState);
  if (recoveredTaskIds.length > 0 || normalizedDanglingStatus) writeJsonAtomic(args['run-state'], runState);

  const executedTaskIds = [];
  acquireLock(runState, owner, startedAt);
  writeJsonAtomic(args['run-state'], runState);

  try {
    await runRuntimePreflight({ args, project, taskPlan, runState, templatesDir, featureDir });
    writeJsonAtomic(args['run-state'], runState);

    let executed = 0;
    const executedThisLoop = new Set();
    while (maxTasks === 0 || executed < maxTasks) {
      promotePending(runState, tasksById);
      const task = findNextRunnable(taskPlan, runState, executedThisLoop);
      if (!task) break;
      const state = runState.taskStates[task.id];
      const startedTaskAt = nowIso();
      state.status = 'running';
      state.attempts += 1;
      state.updatedAt = startedTaskAt;
      runState.currentTaskId = task.id;
      runState.updatedAt = startedTaskAt;
      runState.activeRunLock.heartbeatAt = startedTaskAt;
      runState.activeRunLock.expiresAt = addMinutesIso(30);
      writeJsonAtomic(args['run-state'], runState);

      let taskContext = null;
      let taskContextPath = artifactPath(featureDir, task.id, 'task-context.json');
      try {
        taskContext = buildTaskContext({
          project,
          prd,
          taskPlan,
          taskId: task.id,
          templatesDir,
          repoRoot,
        });
        writeJsonAtomic(taskContextPath, taskContext);
        if (!runState.artifacts.some((artifact) => artifact.type === 'taskContext' && artifact.path === taskContextPath)) {
          runState.artifacts.push({ type: 'taskContext', path: taskContextPath });
        }

        if (['codex', 'external'].includes(adapter.id)) {
          const preflight = runTaskPreflight(taskContext);
          if (!preflight.passed) {
            const finishedTaskAt = nowIso();
            const desiredStatus = 'needs_human';
            const lastIssue = {
              type: 'task_preflight_failed',
              summary: preflight.outcome.summary,
              source: 'orchestrator',
              requiredDecision: '请按 nextActions 准备基座依赖后恢复任务。',
              createdAt: finishedTaskAt,
            };
            const taskRun = buildTaskRun({
              runState,
              task,
              attempt: state.attempts,
              status: desiredStatus,
              startedAt: startedTaskAt,
              finishedAt: finishedTaskAt,
              lastIssue,
              args,
              taskContextPath,
              taskContext,
              changedFiles: [],
              outcome: preflight.outcome,
            });
            const taskRunPath = artifactPath(featureDir, task.id, 'task-run.json');
            const mergedTaskRun = mergeTaskRun(readJsonIfExists(taskRunPath), taskRun);
            schemaValidateArtifact('task-run', mergedTaskRun, taskRunPath);
            writeJsonAtomic(taskRunPath, mergedTaskRun);
            if (!runState.artifacts.some((artifact) => artifact.type === 'taskRun' && artifact.path === taskRunPath)) {
              runState.artifacts.push({ type: 'taskRun', path: taskRunPath });
            }
            state.status = desiredStatus;
            state.lastIssue = lastIssue;
            state.lastRunId = runState.runId;
            state.updatedAt = finishedTaskAt;
            runState.updatedAt = finishedTaskAt;
            executedTaskIds.push(task.id);
            executedThisLoop.add(task.id);
            executed += 1;
            writeJsonAtomic(args['run-state'], runState);
            continue;
          }
        }

        const beforeGitSnapshot = collectGitDiffSnapshot(taskContext.base.workspaceAbs);
        const outcome = adapter.execute({
          args,
          project,
          prd,
          taskContext,
          taskPlan,
          runState,
          task,
          state,
          attempt: state.attempts,
          startedAt: startedTaskAt,
          taskContextPath,
        });
        validateAdapterOutcome(outcome, adapter.id);
        recordOutcomeArtifacts(runState, outcome);
        const afterGitSnapshot = collectGitDiffSnapshot(taskContext.base.workspaceAbs);
        const changedFiles = changedFilesBetweenSnapshots(beforeGitSnapshot, afterGitSnapshot);
        const changeAwareOutcome = normalizeOutcomeWithChangedFiles({ outcome, adapterId: adapter.id, changedFiles, args });
        const checkResult = runChecks(task, {
          mode: checksMode,
          cwd: taskContext.base.workspaceAbs,
          mockFailCheckId: args['mock-fail-check'] ?? '',
        });
        const checkedOutcome = normalizeOutcomeWithChecks({ outcome: changeAwareOutcome, checkResult });
        const finishedTaskAt = nowIso();
        const reviewTaskRun = { attempts: [{ attempt: state.attempts, changedFiles }] };
        const review = checkedOutcome.requestedStatus === 'done'
          ? runReview({ runState, taskContext, outcome: checkedOutcome, reviewedAt: finishedTaskAt, taskRun: reviewTaskRun })
          : null;
        const normalizedOutcome = normalizeOutcomeWithReview({ outcome: checkedOutcome, review });
        const desiredStatus = retryAwareStatus(state, normalizedOutcome.requestedStatus);
        const lastIssue = desiredStatus === 'done' ? null : {
          type: desiredStatus === 'needs_human' ? 'needs_human' : `${desiredStatus}_adapter`,
          summary: normalizedOutcome.summary || `${adapter.id} adapter marked ${task.id} as ${desiredStatus}`,
          source: normalizedOutcome.source ?? 'orchestrator',
          requiredDecision: desiredStatus === 'needs_human' ? '请人工确认后恢复任务。' : '',
          createdAt: finishedTaskAt,
        };
        const taskRun = buildTaskRun({
          runState,
          task,
          attempt: state.attempts,
          status: desiredStatus === 'done' ? 'passed' : desiredStatus,
          startedAt: startedTaskAt,
          finishedAt: finishedTaskAt,
          lastIssue,
          args,
          taskContextPath,
          taskContext,
          changedFiles,
          outcome: {
            ...normalizedOutcome,
            summary: desiredStatus === 'done'
              ? normalizedOutcome.summary
              : normalizedOutcome.summary || `${adapter.id} adapter marked ${task.id} as ${desiredStatus}`,
          },
        });
        const taskRunPath = artifactPath(featureDir, task.id, 'task-run.json');
        const mergedTaskRun = mergeTaskRun(readJsonIfExists(taskRunPath), taskRun);
        schemaValidateArtifact('task-run', mergedTaskRun, taskRunPath);
        writeJsonAtomic(taskRunPath, mergedTaskRun);
        if (!runState.artifacts.some((artifact) => artifact.type === 'taskRun' && artifact.path === taskRunPath)) {
          runState.artifacts.push({ type: 'taskRun', path: taskRunPath });
        }

        if (review || normalizedOutcome.reviewVerdict) {
          const reviewArtifact = review ?? runReview({ runState, taskContext, outcome: normalizedOutcome, reviewedAt: finishedTaskAt, taskRun: reviewTaskRun });
          const reviewPath = artifactPath(featureDir, task.id, 'review.json');
          schemaValidateArtifact('review', reviewArtifact, reviewPath);
          writeJsonAtomic(reviewPath, reviewArtifact);
          if (!runState.artifacts.some((artifact) => artifact.type === 'review' && artifact.path === reviewPath)) {
            runState.artifacts.push({ type: 'review', path: reviewPath });
          }
        }

        state.status = desiredStatus;
        state.lastIssue = lastIssue;
        state.lastRunId = runState.runId;
        state.updatedAt = finishedTaskAt;
        if (desiredStatus === 'done' && !runState.completedTasks.includes(task.id)) runState.completedTasks.push(task.id);
        runState.updatedAt = finishedTaskAt;
        executedTaskIds.push(task.id);
        executedThisLoop.add(task.id);
        executed += 1;
        writeJsonAtomic(args['run-state'], runState);
      } catch (error) {
        const failedAt = nowIso();
        const lastIssue = {
          type: 'orchestrator_error',
          summary: `Run Loop 执行 ${task.id} 时异常：${error.message}`,
          source: 'orchestrator',
          requiredDecision: '请检查运行产物和修复 orchestrator 错误后恢复任务。',
          createdAt: failedAt,
        };
        if (taskContext) {
          const taskRunPath = artifactPath(featureDir, task.id, 'task-run.json');
          const taskRun = buildTaskRun({
            runState,
            task,
            attempt: state.attempts,
            status: 'needs_human',
            startedAt: startedTaskAt,
            finishedAt: failedAt,
            lastIssue,
            args,
            taskContextPath,
            taskContext,
            changedFiles: [],
            outcome: orchestratorFailureOutcome(error),
          });
          recordOutcomeArtifacts(runState, orchestratorFailureOutcome(error));
          const mergedTaskRun = mergeTaskRun(readJsonIfExists(taskRunPath), taskRun);
          schemaValidateArtifact('task-run', mergedTaskRun, taskRunPath);
          writeJsonAtomic(taskRunPath, mergedTaskRun);
          if (!runState.artifacts.some((artifact) => artifact.type === 'taskRun' && artifact.path === taskRunPath)) {
            runState.artifacts.push({ type: 'taskRun', path: taskRunPath });
          }
        }
        state.status = 'needs_human';
        state.lastIssue = lastIssue;
        state.lastRunId = runState.runId;
        state.updatedAt = failedAt;
        runState.updatedAt = failedAt;
        executedTaskIds.push(task.id);
        executedThisLoop.add(task.id);
        executed += 1;
        writeJsonAtomic(args['run-state'], runState);
      }
    }
  } finally {
    releaseLock(runState);
    runState.status = recomputeRunStatus(runState);
    writeJsonAtomic(args['run-state'], runState);
  }

  const finishedAt = nowIso();
  const loopSummary = buildLoopSummary({ runState, taskPlan, startedAt, finishedAt, executedTaskIds, featureDir });
  const loopSummaryPath = path.join(featureDir, 'loop-summary.json');
  schemaValidateArtifact('loop-summary', loopSummary, loopSummaryPath);
  writeJsonAtomic(loopSummaryPath, loopSummary);

  const postReport = validateFiles({
    project: args.project,
    prd: args.prd,
    'task-plan': args['task-plan'],
    'run-state': args['run-state'],
    'templates-dir': templatesDir,
  });
  validateOrThrow(postReport, 'Run Loop 后置 Validator');

  return { ok: true, loopSummaryPath: path.resolve(repoRoot, loopSummaryPath), executedTaskIds, summary: loopSummary };
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help) {
      console.log(usage());
      return;
    }
    const result = await runLoop(args);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

if (process.argv[1] && __filename === path.resolve(process.argv[1])) {
  main();
}

export { runLoop };
