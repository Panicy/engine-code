#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

function usage() {
  return [
    '用法：node tools/prd-builder/create-prd.mjs \\',
    '  --feature-id <feature-id> \\',
    '  --name <功能名称> \\',
    '  --summary <功能摘要> \\',
    '  --bases backend,middle,client \\',
    '  --out <prd.json>',
    '',
    '可选：',
    '  --prd-id PRD-XXX',
    '  --story-title <用户故事标题>',
    '  --story <用户故事正文>',
    '  --goal <业务目标>',
    '  --non-goal <非目标>',
    '  --priority must|should|could',
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

function toPrdId(featureId) {
  return `PRD-${featureId.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function splitCsv(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function techStackFromBases(bases) {
  const mapping = {
    backend: 'backend-starter',
    middle: 'middle-starter',
    client: 'uniapp-template',
  };
  return bases.map((base) => mapping[base] ?? base);
}

function buildPrd(args) {
  requireArg(args, 'feature-id');
  requireArg(args, 'name');
  requireArg(args, 'summary');
  requireArg(args, 'bases');
  requireArg(args, 'out');

  const featureId = args['feature-id'];
  const bases = splitCsv(args.bases);
  const timestamp = nowIso();
  const storyTitle = args['story-title'] ?? `${args.name}基础能力`;
  const story = args.story ?? `作为目标用户，我希望${args.summary}。`;
  const goal = args.goal ?? args.summary;
  const nonGoal = args['non-goal'] ?? '不包含未在本 PRD 明确描述的扩展能力。';

  return {
    schemaVersion: '0.1.0',
    prdId: args['prd-id'] ?? toPrdId(featureId),
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
    feature: {
      id: featureId,
      name: args.name,
      summary: args.summary,
      branchName: `feature/${featureId}`,
    },
    impactedBaseIds: bases,
    goals: [
      {
        id: 'G-001',
        text: goal,
      },
    ],
    nonGoals: [
      {
        id: 'NG-001',
        text: nonGoal,
      },
    ],
    personas: [
      {
        id: 'user',
        name: '目标用户',
        description: '需要使用该功能完成业务流程的用户。',
      },
    ],
    userStories: [
      {
        id: 'US-001',
        title: storyTitle,
        story,
        acceptanceCriteria: [
          {
            id: 'AC-001',
            text: `${args.name}的核心流程可以按预期完成。`,
            verification: '通过后续 task-plan 中定义的后端接口、中台页面、客户端页面或跨端验收检查验证。',
          },
        ],
        priority: args.priority ?? 'must',
        dependencies: [],
      },
    ],
    constraints: {
      techStack: techStackFromBases(bases),
      architecture: ['按用户故事拆分任务；每个 task 只落到一个项目内子项目和一个 primary skill。'],
      security: ['受保护接口必须保留鉴权和权限控制；不通过移除鉴权规避测试。'],
      ux: ['中台和客户端遵循现有项目交互与组件规范。'],
      performance: [],
      quality: ['PRD 和 task-plan 必须人工确认后才能进入自动执行。'],
    },
    risks: [],
    humanApproval: {
      approved: false,
      approvedBy: null,
      approvedAt: null,
      notes: '',
    },
  };
}

function writeJson(filePath, value) {
  const abs = path.resolve(repoRoot, filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return abs;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
    if (args.help) {
      console.log(usage());
      return;
    }
    const prd = buildPrd(args);
    const outputPath = writeJson(args.out, prd);
    console.log(JSON.stringify({
      ok: true,
      outputPath,
      prdId: prd.prdId,
      status: prd.status,
      message: 'PRD 草稿已生成，需人工确认后才能进入任务拆分。',
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

export { buildPrd };
