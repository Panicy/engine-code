#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

function usage() {
  return [
    '用法：node tools/recovery/show-task.mjs \\',
    '  --feature-dir <feature-dir> \\',
    '  --run-state <run-state.json> \\',
    '  --task-id TASK-001',
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

function readJsonIfExists(filePath) {
  const abs = path.resolve(repoRoot, filePath);
  if (!fs.existsSync(abs)) return null;
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function fileExists(filePath) {
  return fs.existsSync(path.resolve(repoRoot, filePath));
}

function summarizeTaskRun(taskRun) {
  if (!taskRun) return null;
  return {
    runId: taskRun.runId,
    taskId: taskRun.taskId,
    attempts: (taskRun.attempts ?? []).map((attempt) => ({
      attempt: attempt.attempt,
      status: attempt.status,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt ?? null,
      changedFiles: attempt.changedFiles ?? [],
      checks: (attempt.checks ?? []).map((check) => ({
        id: check.id,
        status: check.status,
        summary: check.summary ?? '',
      })),
      lastIssue: attempt.lastIssue ?? null,
      summary: attempt.summary ?? '',
      errors: attempt.errors ?? [],
      nextActions: attempt.nextActions ?? [],
    })),
  };
}

function summarizeReview(review) {
  if (!review) return null;
  return {
    verdict: review.verdict,
    reviewedAt: review.reviewedAt,
    summary: review.summary ?? '',
    requiredFixes: review.requiredFixes ?? [],
    scopeFindings: review.scopeFindings ?? [],
    architectureFindings: review.architectureFindings ?? [],
    testFindings: review.testFindings ?? [],
  };
}

function listAgentLogs(taskDir) {
  const absTaskDir = path.resolve(repoRoot, taskDir);
  if (!fs.existsSync(absTaskDir)) return [];
  return fs.readdirSync(absTaskDir)
    .filter((entry) => /-(attempt-\d+)-(stdout|stderr)\.log$/.test(entry))
    .sort()
    .map((entry) => path.join(taskDir, entry));
}

function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help) {
      console.log(usage());
      return;
    }
    requireArg(args, 'feature-dir');
    requireArg(args, 'run-state');
    requireArg(args, 'task-id');

    const runState = readJson(args['run-state']);
    const taskState = runState.taskStates?.[args['task-id']];
    if (!taskState) throw new Error(`task 不存在：${args['task-id']}`);

    const taskDir = path.join(args['feature-dir'], 'runs', args['task-id']);
    const taskContextPath = path.join(taskDir, 'task-context.json');
    const taskRunPath = path.join(taskDir, 'task-run.json');
    const reviewPath = path.join(taskDir, 'review.json');
    const taskRun = readJsonIfExists(taskRunPath);
    const review = readJsonIfExists(reviewPath);
    console.log(JSON.stringify({
      ok: true,
      runId: runState.runId,
      taskId: args['task-id'],
      state: taskState,
      lastIssue: taskState.lastIssue ?? null,
      diagnostics: {
        currentTask: runState.currentTaskId === args['task-id'],
        activeRunLock: runState.activeRunLock ?? null,
        taskContextExists: fileExists(taskContextPath),
        taskRunExists: fileExists(taskRunPath),
        reviewExists: fileExists(reviewPath),
        agentLogPaths: listAgentLogs(taskDir),
      },
      taskRun: summarizeTaskRun(taskRun),
      review: summarizeReview(review),
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }
}

if (process.argv[1] && __filename === path.resolve(process.argv[1])) {
  main();
}
