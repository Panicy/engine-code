#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSchema } from '../validator/validate-feature.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const retryableStatuses = new Set(['checks_failed', 'review_failed', 'needs_human']);
const actions = new Set(['retry', 'cancel']);

function usage() {
  return [
    '用法：node tools/recovery/resolve-task.mjs \\',
    '  --run-state <run-state.json> \\',
    '  --task-id TASK-001 \\',
    '  --action retry|cancel \\',
    '  --by <处理人> \\',
    '  --reason <原因>',
    '',
    '可选：',
    '  --allow-done   允许将误标 done 的 task 恢复为 ready',
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
    if (arg === '--allow-done') {
      args['allow-done'] = true;
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
  const tmp = `${abs}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, abs);
}

function nowIso() {
  return new Date().toISOString();
}

function nextDecisionId(runState) {
  return `DEC-${String((runState.decisions ?? []).length + 1).padStart(3, '0')}`;
}

function resolveStatus(fromStatus, action, options = {}) {
  if (action === 'retry') {
    if (fromStatus === 'done' && options.allowDone === true) return 'ready';
    if (!retryableStatuses.has(fromStatus)) {
      throw new Error(`状态 ${fromStatus} 不允许 retry。`);
    }
    return 'ready';
  }
  if (action === 'cancel') {
    if (fromStatus !== 'needs_human') {
      throw new Error('cancel 仅允许 needs_human 任务。');
    }
    return 'cancelled';
  }
  throw new Error(`非法 action：${action}`);
}

function assertValidRunState(runState, filePath) {
  const schema = readSchema('run-state');
  const errors = validateSchema(runState, schema, { file: filePath, rootSchema: schema });
  if (errors.length > 0) {
    throw new Error(`run-state 不符合 schema：\n${JSON.stringify(errors, null, 2)}`);
  }
}

function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help) {
      console.log(usage());
      return;
    }
    requireArg(args, 'run-state');
    requireArg(args, 'task-id');
    requireArg(args, 'action');
    requireArg(args, 'by');
    requireArg(args, 'reason');
    if (!actions.has(args.action)) throw new Error(`非法 action：${args.action}`);

    const runState = readJson(args['run-state']);
    const taskState = runState.taskStates?.[args['task-id']];
    if (!taskState) throw new Error(`task 不存在：${args['task-id']}`);

    const fromStatus = taskState.status;
    const toStatus = resolveStatus(fromStatus, args.action, { allowDone: args['allow-done'] === true });
    const decidedAt = nowIso();
    taskState.status = toStatus;
    taskState.updatedAt = decidedAt;
    if (toStatus === 'ready') taskState.lastIssue = null;
    if (fromStatus === 'done' && toStatus === 'ready') {
      runState.completedTasks = (runState.completedTasks ?? []).filter((taskId) => taskId !== args['task-id']);
    }
    if (runState.currentTaskId === args['task-id']) runState.currentTaskId = null;
    runState.updatedAt = decidedAt;
    if (!['running'].includes(runState.status)) {
      const hasIssue = Object.values(runState.taskStates).some((state) => ['checks_failed', 'review_failed', 'needs_human'].includes(state.status));
      const hasUnfinished = Object.values(runState.taskStates).some((state) => !['done', 'cancelled'].includes(state.status));
      runState.status = hasIssue ? 'failed' : hasUnfinished ? 'paused' : 'complete';
    }
    const decision = {
      id: nextDecisionId(runState),
      text: `${args.by} ${args.action} ${args['task-id']}: ${args.reason}`,
      createdAt: decidedAt,
      taskId: args['task-id'],
      action: args.action,
      fromStatus,
      toStatus,
      by: args.by,
      reason: args.reason,
      decidedAt,
    };
    runState.decisions = [...(runState.decisions ?? []), decision];
    assertValidRunState(runState, args['run-state']);
    writeJsonAtomic(args['run-state'], runState);
    console.log(JSON.stringify({
      ok: true,
      runStatePath: path.resolve(repoRoot, args['run-state']),
      taskId: args['task-id'],
      action: args.action,
      fromStatus,
      toStatus,
      decision,
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
