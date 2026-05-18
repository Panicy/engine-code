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
    '  [--bases backend,middle,client] \\',
    '  --out <prd.json>',
    '',
    '可选：',
    '  --project <project.json>',
    '  --prd-id PRD-XXX',
    '  --stories-file <stories.json>',
    '  --story-title <用户故事标题>',
    '  --story <用户故事正文>',
    '  --goal <业务目标>',
    '  --non-goal <非目标>',
    '  --priority must|should|could',
    '  --force',
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

function readJson(filePath) {
  const abs = path.resolve(repoRoot, filePath);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function toPrdId(featureId) {
  return `PRD-${featureId.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function splitCsv(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function techStackFromBases(bases, project) {
  if (project) {
    const byBaseId = new Map((project.bases ?? []).map((base) => [base.baseId, base.templateId]));
    return bases.map((baseId) => byBaseId.get(baseId) ?? baseId);
  }
  const mapping = {
    backend: 'backend-starter',
    middle: 'middle-starter',
    client: 'uniapp-template',
  };
  return bases.map((base) => mapping[base] ?? base);
}

function resolveBases(args, project) {
  if (args.bases) {
    const bases = splitCsv(args.bases);
    if (project) {
      const available = new Set((project.bases ?? []).map((base) => base.baseId));
      const unknown = bases.filter((base) => !available.has(base));
      if (unknown.length > 0) {
        throw new Error(`--bases 包含 project 中不存在的 baseId：${unknown.join(', ')}`);
      }
    }
    return bases;
  }
  if (project) {
    return (project.bases ?? []).map((base) => base.baseId);
  }
  throw new Error('缺少必填参数 --bases，或提供 --project 自动推导 bases');
}

function loadStories(args) {
  if (!args['stories-file']) return null;
  const stories = readJson(args['stories-file']);
  if (!Array.isArray(stories) || stories.length === 0) {
    throw new Error('--stories-file 必须是非空 JSON 数组');
  }
  return stories.map((story, index) => ({
    id: story.id ?? `US-${String(index + 1).padStart(3, '0')}`,
    title: story.title,
    story: story.story,
    acceptanceCriteria: story.acceptanceCriteria,
    priority: story.priority ?? 'must',
    dependencies: story.dependencies ?? [],
  }));
}

function buildPrd(args) {
  requireArg(args, 'feature-id');
  requireArg(args, 'name');
  requireArg(args, 'summary');
  requireArg(args, 'out');

  const featureId = args['feature-id'];
  const project = args.project ? readJson(args.project) : null;
  const bases = resolveBases(args, project);
  const timestamp = nowIso();
  const storyTitle = args['story-title'] ?? `${args.name}基础能力`;
  const story = args.story ?? `作为目标用户，我希望${args.summary}。`;
  const goal = args.goal ?? args.summary;
  const nonGoal = args['non-goal'] ?? '不包含未在本 PRD 明确描述的扩展能力。';
  const stories = loadStories(args) ?? [
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
  ];

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
    userStories: stories,
    businessRules: [],
    dataEntities: [],
    permissions: [],
    openQuestions: [],
    assumptions: [],
    constraints: {
      techStack: techStackFromBases(bases, project),
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
  if (fs.existsSync(abs) && !value.__force) {
    throw new Error(`目标文件已存在，拒绝覆盖：${abs}。如确认覆盖，请使用 --force。`);
  }
  delete value.__force;
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
    prd.__force = args.force === true;
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
