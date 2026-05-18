#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFiles } from '../validator/validate-feature.mjs';

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
    '  --project <project.json>',
    '  --prd <prd.json>',
    '  --run-state <run-state.json>',
    '  --templates-dir .engine/templates',
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

function validateBeforeApprove(args, taskPlan) {
  const hasValidatorInputs = args.project || args.prd || args['run-state'];
  if (!hasValidatorInputs) return;
  requireArg(args, 'project');
  requireArg(args, 'prd');
  requireArg(args, 'run-state');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-task-plan-approve-'));
  const tmpTaskPlanPath = path.join(tmpDir, 'task-plan.approved.json');
  fs.writeFileSync(tmpTaskPlanPath, `${JSON.stringify(taskPlan, null, 2)}\n`, 'utf8');

  const report = validateFiles({
    project: args.project,
    prd: args.prd,
    'task-plan': tmpTaskPlanPath,
    'run-state': args['run-state'],
    'templates-dir': args['templates-dir'] ?? '.engine/templates',
  });
  if (!report.valid) {
    throw new Error(`Validator 校验失败，拒绝确认 task-plan：\n${JSON.stringify(report, null, 2)}`);
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

    validateBeforeApprove(args, taskPlan);
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
