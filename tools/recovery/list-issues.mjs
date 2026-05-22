#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const issueStatuses = new Set(['checks_failed', 'review_failed', 'needs_human']);

function usage() {
  return [
    '用法：node tools/recovery/list-issues.mjs \\',
    '  --run-state <run-state.json>',
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

function issuesFromRunState(runState) {
  return Object.entries(runState.taskStates ?? {})
    .filter(([, state]) => issueStatuses.has(state.status))
    .map(([taskId, state]) => ({
      taskId,
      status: state.status,
      source: state.lastIssue?.source ?? 'orchestrator',
      summary: state.lastIssue?.summary ?? `${taskId} ${state.status}`,
      attempts: state.attempts,
      maxAttempts: state.maxAttempts ?? null,
      retryExhausted: Boolean(state.maxAttempts && state.attempts >= state.maxAttempts),
      requiredDecision: state.lastIssue?.requiredDecision ?? '',
      nextRunnable: ['checks_failed', 'review_failed'].includes(state.status),
      updatedAt: state.updatedAt,
    }));
}

function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help) {
      console.log(usage());
      return;
    }
    requireArg(args, 'run-state');
    const runState = readJson(args['run-state']);
    console.log(JSON.stringify({
      ok: true,
      runId: runState.runId,
      issues: issuesFromRunState(runState),
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

export { issuesFromRunState };
