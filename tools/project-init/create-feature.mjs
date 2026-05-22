#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateFiles } from '../validator/validate-feature.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

function usage() {
  return [
    '用法：node tools/project-init/create-feature.mjs \\',
    '  --feature-id <feature-id> \\',
    '  --name <功能名称> \\',
    '  --summary <功能摘要> \\',
    '  --project <project.json> \\',
    '  --bases backend,middle \\',
    '  --out-dir <feature-dir>',
    '',
    '可选：',
    '  --approve-prd-by <确认人>',
    '  --approve-task-plan-by <确认人>',
    '  --force',
    '',
    '默认只生成 draft prd.json；显式 --approve-prd-by 后才会生成 task-plan.json 和 run-state.json。',
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
    if (arg === '--force') {
      args.force = true;
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

function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error([
      `命令失败：node ${script} ${args.join(' ')}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join('\n'));
  }
  return JSON.parse(result.stdout);
}

function outputPaths(outDir) {
  return {
    prd: path.join(outDir, 'prd.json'),
    taskPlan: path.join(outDir, 'task-plan.json'),
    runState: path.join(outDir, 'run-state.json'),
  };
}

function ensureOutputsWritable(paths, force) {
  if (force === true) return;
  for (const filePath of Object.values(paths)) {
    const abs = path.resolve(repoRoot, filePath);
    if (fs.existsSync(abs)) {
      throw new Error(`目标文件已存在，拒绝覆盖：${abs}。如确认覆盖，请使用 --force。`);
    }
  }
}

function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help) {
      console.log(usage());
      return;
    }
    requireArg(args, 'feature-id');
    requireArg(args, 'name');
    requireArg(args, 'summary');
    requireArg(args, 'project');
    requireArg(args, 'bases');
    requireArg(args, 'out-dir');

    const paths = outputPaths(args['out-dir']);
    ensureOutputsWritable(paths, args.force);
    const forceArgs = args.force ? ['--force'] : [];

    const prdResult = runNode('tools/prd-builder/create-prd.mjs', [
      '--feature-id', args['feature-id'],
      '--name', args.name,
      '--summary', args.summary,
      '--project', args.project,
      '--bases', args.bases,
      '--out', paths.prd,
      ...forceArgs,
    ]);

    let approvePrdResult = null;
    let taskPlanResult = null;
    let approveTaskPlanResult = null;
    let validation = null;

    if (args['approve-prd-by']) {
      approvePrdResult = runNode('tools/prd-builder/approve-prd.mjs', [
        '--prd', paths.prd,
        '--by', args['approve-prd-by'],
      ]);
      taskPlanResult = runNode('tools/task-planner/create-task-plan.mjs', [
        '--project', args.project,
        '--prd', paths.prd,
        '--out', paths.taskPlan,
        '--run-state-out', paths.runState,
        ...forceArgs,
      ]);

      if (args['approve-task-plan-by']) {
        approveTaskPlanResult = runNode('tools/task-planner/approve-task-plan.mjs', [
          '--project', args.project,
          '--prd', paths.prd,
          '--task-plan', paths.taskPlan,
          '--run-state', paths.runState,
          '--by', args['approve-task-plan-by'],
        ]);
      }

      validation = validateFiles({
        project: args.project,
        prd: paths.prd,
        'task-plan': paths.taskPlan,
        'run-state': paths.runState,
        'templates-dir': '.engine/templates',
      });
      if (!validation.valid && approveTaskPlanResult) {
        throw new Error(`Validator 校验失败：\n${JSON.stringify(validation, null, 2)}`);
      }
    } else if (args['approve-task-plan-by']) {
      throw new Error('--approve-task-plan-by 需要同时提供 --approve-prd-by。');
    }

    console.log(JSON.stringify({
      ok: true,
      prdPath: path.resolve(repoRoot, paths.prd),
      taskPlanPath: taskPlanResult ? path.resolve(repoRoot, paths.taskPlan) : null,
      runStatePath: taskPlanResult ? path.resolve(repoRoot, paths.runState) : null,
      prdApproved: Boolean(approvePrdResult),
      taskPlanApproved: Boolean(approveTaskPlanResult),
      validationPassed: validation?.valid ?? null,
      message: taskPlanResult
        ? 'feature 初始化完成。'
        : '已生成 draft prd.json；默认不自动 approve，因此未生成 task-plan.json 和 run-state.json。',
      steps: {
        prd: prdResult,
        approvePrd: approvePrdResult,
        taskPlan: taskPlanResult,
        approveTaskPlan: approveTaskPlanResult,
      },
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
