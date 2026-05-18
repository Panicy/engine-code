#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTaskContext } from './index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

function usage() {
  return [
    '用法：node tools/skill-context/build-task-context.mjs \\',
    '  --project <project.json> \\',
    '  --prd <prd.json> \\',
    '  --task-plan <task-plan.json> \\',
    '  --task-id TASK-001',
    '',
    '可选：',
    '  --templates-dir .engine/templates',
    '  --out <task-context.json>',
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

function writeJson(filePath, value) {
  const abs = path.resolve(repoRoot, filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return abs;
}

function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help) {
      console.log(usage());
      return;
    }
    requireArg(args, 'project');
    requireArg(args, 'prd');
    requireArg(args, 'task-plan');
    requireArg(args, 'task-id');

    const context = buildTaskContext({
      project: readJson(args.project),
      prd: readJson(args.prd),
      taskPlan: readJson(args['task-plan']),
      taskId: args['task-id'],
      templatesDir: args['templates-dir'] ?? '.engine/templates',
      repoRoot,
    });
    if (args.out) {
      const outputPath = writeJson(args.out, context);
      console.log(JSON.stringify({ ok: true, outputPath, taskId: context.task.id, skillId: context.skill.id }, null, 2));
      return;
    }
    console.log(JSON.stringify(context, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }
}

main();
