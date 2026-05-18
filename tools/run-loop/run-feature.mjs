#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFiles, validateSchema } from '../validator/validate-feature.mjs';

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
    '  --max-tasks 0',
    '  --mock-fail-task TASK-001',
    '  --mock-fail-stage check|review|human',
    '  --owner run-loop',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${arg} 缺少值`);
    args[key] = value;
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

function addMinutesIso(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function flattenTasks(taskPlan) {
  return taskPlan.storyGroups.flatMap((group) => group.tasks.map((task) => ({ ...task, storyId: group.storyId, storyTitle: group.title })));
}

function taskMap(taskPlan) {
  return new Map(flattenTasks(taskPlan).map((task) => [task.id, task]));
}

function validateOrThrow(report, label) {
  if (!report.valid) {
    throw new Error(`${label} 校验失败：\n${JSON.stringify(report, null, 2)}`);
  }
}

function acquireLock(runState, owner) {
  const existing = runState.activeRunLock;
  if (existing && Date.parse(existing.expiresAt) > Date.now()) {
    throw new Error(`Run Loop 已被 ${existing.owner} 锁定，expiresAt=${existing.expiresAt}`);
  }
  const timestamp = nowIso();
  runState.activeRunLock = {
    lockId: `LOCK-${Date.now()}`,
    owner,
    acquiredAt: timestamp,
    heartbeatAt: timestamp,
    expiresAt: addMinutesIso(30),
  };
  runState.status = 'running';
  runState.updatedAt = timestamp;
}

function releaseLock(runState) {
  runState.activeRunLock = null;
  runState.currentTaskId = null;
  runState.updatedAt = nowIso();
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

function checkCommand(check) {
  if (check.command) return check.command;
  if (check.http) return `${check.http.method} ${check.http.url} -> ${check.http.expectedStatus}`;
  if (check.manual) return `manual: ${check.manual.instruction}`;
  return check.type;
}

function buildTaskRun({ runState, task, attempt, status, startedAt, finishedAt, lastIssue, args }) {
  const checks = (task.checks ?? []).map((check) => ({
    id: check.id,
    command: checkCommand(check),
    status: status === 'checks_failed' ? 'failed' : 'passed',
    summary: status === 'checks_failed' ? 'mock check failed' : 'mock check passed',
  }));
  const item = {
    attempt,
    status,
    agent: { tool: 'mock-agent', model: 'mock' },
    startedAt,
    finishedAt,
    promptInputs: [
      { type: 'prd', path: args.prd },
      { type: 'taskPlan', path: args['task-plan'] },
      { type: 'runState', path: args['run-state'] },
      { type: 'task', path: `${args['task-plan']}#${task.id}` },
      { type: 'skill', path: task.requiredSkillId },
    ],
    changedFiles: [],
    checks,
    summary: status === 'passed' ? `mock agent completed ${task.id}` : `mock agent marked ${task.id} as ${status}`,
    errors: [],
    nextActions: status === 'passed' ? [] : ['下一轮自动重试或人工处理。'],
  };
  if (lastIssue) item.lastIssue = lastIssue;
  return {
    schemaVersion: '0.1.0',
    runId: runState.runId,
    taskId: task.id,
    attempts: [item],
  };
}

function buildReview({ runState, task, verdict, reviewedAt }) {
  return {
    schemaVersion: '0.1.0',
    runId: runState.runId,
    taskId: task.id,
    verdict,
    reviewedAt,
    criteriaResults: (task.acceptanceCriteria ?? [{ id: 'AC-001', text: task.title }]).map((criterion) => ({
      criterionId: criterion.id,
      status: verdict === 'pass' ? 'pass' : 'fail',
      evidence: verdict === 'pass' ? 'mock review passed' : 'mock review failed',
    })),
    scopeFindings: [],
    architectureFindings: [],
    testFindings: [],
    requiredFixes: verdict === 'pass' ? [] : [{ id: 'FIX-001', description: 'mock review requires changes' }],
    suggestedFollowUpTasks: [],
    summary: verdict === 'pass' ? `mock review passed ${task.id}` : `mock review ${verdict} for ${task.id}`,
  };
}

function decideMockOutcome(task, args) {
  if (args['mock-fail-task'] !== task.id) return { taskRunStatus: 'passed', reviewVerdict: 'pass', nextStatus: 'done' };
  const stage = args['mock-fail-stage'] ?? 'check';
  if (stage === 'check') return { taskRunStatus: 'checks_failed', reviewVerdict: null, nextStatus: 'checks_failed', source: 'check' };
  if (stage === 'review') return { taskRunStatus: 'review_failed', reviewVerdict: 'fail', nextStatus: 'review_failed', source: 'reviewer' };
  return { taskRunStatus: 'needs_human', reviewVerdict: 'needs_human', nextStatus: 'needs_human', source: 'reviewer' };
}

function retryAwareStatus(state, desiredStatus) {
  if ((desiredStatus === 'checks_failed' || desiredStatus === 'review_failed') && state.maxAttempts && state.attempts >= state.maxAttempts) {
    return 'needs_human';
  }
  return desiredStatus;
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
  return {
    schemaVersion: '0.1.0',
    runId: runState.runId,
    planId: runState.planId,
    startedAt,
    finishedAt,
    status: abnormalTasks.length > 0 ? 'has_exceptions' : 'complete',
    taskSummary,
    issues,
    abnormalTasks,
    nextRunnableTaskIds,
  };
}

function runLoop(args) {
  requireArg(args, 'project');
  requireArg(args, 'prd');
  requireArg(args, 'task-plan');
  requireArg(args, 'run-state');
  const startedAt = nowIso();
  const templatesDir = args['templates-dir'] ?? '.engine/templates';
  const owner = args.owner ?? 'run-loop';
  const maxTasks = Number.parseInt(args['max-tasks'] ?? '0', 10);
  const featureDir = path.dirname(args['task-plan']);
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

  const executedTaskIds = [];
  acquireLock(runState, owner);
  writeJsonAtomic(args['run-state'], runState);

  try {
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

      const outcome = decideMockOutcome(task, args);
      const finishedTaskAt = nowIso();
      const desiredStatus = retryAwareStatus(state, outcome.nextStatus);
      const lastIssue = desiredStatus === 'done' ? null : {
        type: desiredStatus === 'needs_human' ? 'needs_human' : `${desiredStatus}_mock`,
        summary: `mock ${desiredStatus} for ${task.id}`,
        source: outcome.source ?? 'orchestrator',
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
      });
      const taskRunPath = artifactPath(featureDir, task.id, 'task-run.json');
      schemaValidateArtifact('task-run', taskRun, taskRunPath);
      writeJsonAtomic(taskRunPath, taskRun);
      runState.artifacts.push({ type: 'taskRun', path: taskRunPath });

      if (outcome.reviewVerdict) {
        const review = buildReview({ runState, task, verdict: outcome.reviewVerdict, reviewedAt: finishedTaskAt });
        const reviewPath = artifactPath(featureDir, task.id, 'review.json');
        schemaValidateArtifact('review', review, reviewPath);
        writeJsonAtomic(reviewPath, review);
        runState.artifacts.push({ type: 'review', path: reviewPath });
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
    }
  } finally {
    releaseLock(runState);
    const unfinished = Object.values(runState.taskStates).some((state) => !['done', 'cancelled'].includes(state.status));
    const hasException = Object.values(runState.taskStates).some((state) => ['checks_failed', 'review_failed', 'needs_human'].includes(state.status));
    runState.status = hasException ? 'failed' : unfinished ? 'paused' : 'complete';
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

function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help) {
      console.log(usage());
      return;
    }
    const result = runLoop(args);
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
