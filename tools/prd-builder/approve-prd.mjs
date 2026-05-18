#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

function usage() {
  return [
    '用法：node tools/prd-builder/approve-prd.mjs \\',
    '  --prd <prd.json> \\',
    '  --by <确认人>',
    '',
    '可选：',
    '  --notes <确认备注>',
    '  --allow-open-questions',
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
    if (arg === '--allow-open-questions') {
      args['allow-open-questions'] = true;
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

function nowIso() {
  return new Date().toISOString();
}

function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help) {
      console.log(usage());
      return;
    }
    requireArg(args, 'prd');
    requireArg(args, 'by');

    const prdPath = path.resolve(repoRoot, args.prd);
    const prd = JSON.parse(fs.readFileSync(prdPath, 'utf8'));
    const openQuestions = (prd.openQuestions ?? []).filter((question) => question.status === 'open');
    if (openQuestions.length > 0 && args['allow-open-questions'] !== true) {
      throw new Error(`PRD 存在未关闭 openQuestions：${openQuestions.map((item) => item.id).join(', ')}。如确认允许，请使用 --allow-open-questions。`);
    }

    const timestamp = nowIso();
    prd.status = 'approved';
    prd.updatedAt = timestamp;
    prd.humanApproval = {
      approved: true,
      approvedBy: args.by,
      approvedAt: timestamp,
      notes: args.notes ?? prd.humanApproval?.notes ?? '',
    };

    fs.writeFileSync(prdPath, `${JSON.stringify(prd, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      ok: true,
      prdPath,
      prdId: prd.prdId,
      status: prd.status,
      approvedBy: prd.humanApproval.approvedBy,
      approvedAt: prd.humanApproval.approvedAt,
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
