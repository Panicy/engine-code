#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

function usage() {
  return [
    '用法：node tools/task-planner/approve-task-plan.mjs \\',
    '  --task-plan <task-plan.json> \\',
    '  --by <确认人>',
    '',
    '可选：',
    '  --notes <确认备注>',
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
    if (!arg.startsWith('--')) {
      throw new Error(`未知参数：${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`参数 ${arg} 缺少值`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function requireArg(args, key) {
  if (!args[key]) {
    throw new Error(`缺少必填参数 --${key}`);
  }
}

function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help) {
      console.log(usage());
      return;
    }
    requireArg(args, 'task-plan');
    requireArg(args, 'by');

    const taskPlanPath = path.resolve(repoRoot, args['task-plan']);
    const taskPlan = JSON.parse(fs.readFileSync(taskPlanPath, 'utf8'));
    const timestamp = new Date().toISOString();
    taskPlan.status = 'approved';
    taskPlan.updatedAt = timestamp;
    taskPlan.humanApproval = {
      approved: true,
      approvedBy: args.by,
      approvedAt: timestamp,
      notes: args.notes ?? taskPlan.humanApproval?.notes ?? '',
    };

    fs.writeFileSync(taskPlanPath, `${JSON.stringify(taskPlan, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      ok: true,
      taskPlanPath,
      planId: taskPlan.planId,
      status: taskPlan.status,
      approvedBy: taskPlan.humanApproval.approvedBy,
      approvedAt: taskPlan.humanApproval.approvedAt,
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
