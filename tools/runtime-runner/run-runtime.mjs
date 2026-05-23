#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRuntimeProfiles } from './index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

function usage() {
  return [
    '用法：node tools/runtime-runner/run-runtime.mjs \\',
    '  --project <project.json> \\',
    '  --out-dir <runs/runtime>',
    '',
    '可选：',
    '  --templates-dir .engine/templates',
    '  --base-ids backend,middle',
    '  --mode mock|check',
    '  --timeout-ms 120000',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { mode: 'check', 'templates-dir': '.engine/templates' };
  const allowed = new Set(['project', 'out-dir', 'templates-dir', 'base-ids', 'mode', 'timeout-ms']);
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    const key = arg.slice(2);
    if (!allowed.has(key)) throw new Error(`未知参数：${arg}`);
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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  requireArg(args, 'project');
  requireArg(args, 'out-dir');
  if (!['mock', 'check'].includes(args.mode)) throw new Error('--mode 必须是 mock 或 check');
  const timeoutMs = Number.parseInt(args['timeout-ms'] ?? '120000', 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) throw new Error('--timeout-ms 必须是大于等于 1000 的整数');

  const projectPath = path.resolve(repoRoot, args.project);
  const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  const baseIds = (args['base-ids'] ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const results = await runRuntimeProfiles({
    project,
    templatesDir: args['templates-dir'],
    baseIds,
    mode: args.mode,
    repoRoot,
    timeoutMs,
  });
  const outDir = path.resolve(repoRoot, args['out-dir']);
  for (const result of results) {
    writeJson(path.join(outDir, `${result.baseId}-runtime.json`), result);
  }
  const summary = {
    ok: results.every((item) => item.status === 'passed'),
    outDir,
    results: results.map((item) => ({ baseId: item.baseId, status: item.status, checks: item.checks.length })),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  console.error(usage());
  process.exit(2);
});
