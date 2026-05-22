#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSchema } from '../validator/validate-feature.mjs';

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
    '  --requirements-file <requirements.json>',
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

function resolveBases(args, project, requirements = null) {
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
  if (requirements?.impactedBaseIds || requirements?.bases) {
    const bases = requirements.impactedBaseIds ?? requirements.bases;
    if (!Array.isArray(bases) || bases.length === 0) {
      throw new Error('--requirements-file 中 impactedBaseIds/bases 必须是非空数组');
    }
    if (project) {
      const available = new Set((project.bases ?? []).map((base) => base.baseId));
      const unknown = bases.filter((base) => !available.has(base));
      if (unknown.length > 0) {
        throw new Error(`requirements impactedBaseIds 包含 project 中不存在的 baseId：${unknown.join(', ')}`);
      }
    }
    return bases;
  }
  if (project) {
    return (project.bases ?? []).map((base) => base.baseId);
  }
  throw new Error('缺少必填参数 --bases，或提供 --project 自动推导 bases');
}

function loadRequirements(args) {
  if (!args['requirements-file']) return null;
  const requirements = readJson(args['requirements-file']);
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) {
    throw new Error('--requirements-file 必须是 JSON 对象');
  }
  return requirements;
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value, fallback = '') {
  if (typeof value === 'string') return value;
  return value?.text ?? value?.description ?? value?.summary ?? fallback;
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} 必须是非空字符串`);
  }
  return value;
}

function normalizeTextItems(items, prefix) {
  return asArray(items).map((item, index) => {
    const id = item?.id ?? `${prefix}-${String(index + 1).padStart(3, '0')}`;
    return {
      id,
      text: requireText(textOf(item), `${prefix}[${index + 1}].text`),
    };
  });
}

function normalizeAcceptanceCriteria(criteria) {
  const source = asArray(criteria);
  if (source.length === 0) {
    return [
      {
        id: 'AC-001',
        text: '核心流程可以按预期完成。',
        verification: '通过 task-plan 中定义的检查验证。',
      },
    ];
  }
  return source.map((criterion, index) => ({
    id: criterion?.id ?? `AC-${String(index + 1).padStart(3, '0')}`,
    text: requireText(textOf(criterion), `acceptanceCriteria[${index + 1}].text`),
    verification: criterion?.verification ?? '通过 task-plan 中定义的检查验证。',
  }));
}

function normalizeStories(stories) {
  return asArray(stories).map((story, index) => ({
    id: story.id ?? `US-${String(index + 1).padStart(3, '0')}`,
    title: requireText(story.title ?? `用户故事 ${index + 1}`, `userStories[${index + 1}].title`),
    story: requireText(story.story ?? story.text ?? story.description, `userStories[${index + 1}].story`),
    acceptanceCriteria: normalizeAcceptanceCriteria(story.acceptanceCriteria ?? story.criteria),
    priority: story.priority ?? 'must',
    dependencies: asArray(story.dependencies ?? story.dependsOn),
  }));
}

function loadStories(args) {
  if (!args['stories-file']) return null;
  const stories = readJson(args['stories-file']);
  if (!Array.isArray(stories) || stories.length === 0) {
    throw new Error('--stories-file 必须是非空 JSON 数组');
  }
  return normalizeStories(stories);
}

function normalizeBusinessRules(rules) {
  return asArray(rules).map((rule, index) => ({
    id: rule?.id ?? `BR-${String(index + 1).padStart(3, '0')}`,
    text: requireText(textOf(rule), `businessRules[${index + 1}].text`),
    verification: rule?.verification ?? '',
  }));
}

function normalizeDataEntities(entities) {
  return asArray(entities).map((entity, index) => ({
    id: entity.id ?? `DE-${String(index + 1).padStart(3, '0')}`,
    name: requireText(entity.name, `dataEntities[${index + 1}].name`),
    description: entity.description ?? entity.summary ?? entity.name,
    fields: asArray(entity.fields).map((field, fieldIndex) => ({
      name: requireText(field.name, `dataEntities[${index + 1}].fields[${fieldIndex + 1}].name`),
      type: requireText(field.type, `dataEntities[${index + 1}].fields[${fieldIndex + 1}].type`),
      required: Boolean(field.required),
      description: field.description ?? '',
    })),
  }));
}

function normalizePermissions(permissions, bases) {
  const available = new Set(bases);
  return asArray(permissions).map((permission, index) => {
    const targetBaseId = permission.targetBaseId ?? permission.baseId ?? (available.has('backend') ? 'backend' : bases[0]);
    if (!available.has(targetBaseId)) {
      throw new Error(`permission ${permission.id ?? index + 1} targetBaseId=${targetBaseId} 不存在于 impactedBaseIds/project.bases。`);
    }
    return {
      id: permission.id ?? `PERM-${String(index + 1).padStart(3, '0')}`,
      code: requireText(permission.code, `permissions[${index + 1}].code`),
      name: permission.name ?? permission.code,
      targetBaseId,
      description: permission.description ?? '',
    };
  });
}

function normalizeOpenQuestions(questions) {
  return asArray(questions).map((question, index) => ({
    id: question.id ?? `Q-${String(index + 1).padStart(3, '0')}`,
    question: requireText(question.question ?? question.text, `openQuestions[${index + 1}].question`),
    status: question.status ?? 'open',
    answer: question.answer ?? '',
  }));
}

function normalizeRisks(risks) {
  return asArray(risks).map((risk, index) => ({
    id: risk.id ?? `RISK-${String(index + 1).padStart(3, '0')}`,
    description: requireText(risk.description ?? risk.text, `risks[${index + 1}].description`),
    mitigation: risk.mitigation ?? '执行前由人工确认风险处置方式。',
  }));
}

function normalizePersonas(personas) {
  return asArray(personas).map((persona, index) => ({
    id: persona.id ?? `persona-${index + 1}`,
    name: requireText(persona.name, `personas[${index + 1}].name`),
    description: persona.description ?? '',
  }));
}

function mergeConstraints(defaults, requirements = {}) {
  const input = requirements?.constraints ?? {};
  return {
    techStack: asArray(input.techStack).length > 0 ? asArray(input.techStack) : defaults.techStack,
    architecture: [...defaults.architecture, ...asArray(input.architecture)],
    security: [...defaults.security, ...asArray(input.security)],
    ux: [...defaults.ux, ...asArray(input.ux)],
    performance: [...defaults.performance, ...asArray(input.performance)],
    quality: [...defaults.quality, ...asArray(input.quality)],
  };
}

function buildPrd(args) {
  requireArg(args, 'feature-id');
  requireArg(args, 'name');
  requireArg(args, 'summary');
  requireArg(args, 'out');

  const featureId = args['feature-id'];
  const project = args.project ? readJson(args.project) : null;
  const requirements = loadRequirements(args);
  const bases = resolveBases(args, project, requirements);
  const timestamp = nowIso();
  const storyTitle = args['story-title'] ?? `${args.name}基础能力`;
  const story = args.story ?? `作为目标用户，我希望${args.summary}。`;
  const goal = args.goal ?? args.summary;
  const nonGoal = args['non-goal'] ?? '不包含未在本 PRD 明确描述的扩展能力。';
  const requirementStories = normalizeStories(requirements?.userStories ?? requirements?.stories);
  const stories = (requirementStories.length > 0 ? requirementStories : null) ?? loadStories(args) ?? [
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

  const defaultConstraints = {
    techStack: techStackFromBases(bases, project),
    architecture: ['按用户故事拆分任务；每个 task 只落到一个项目内子项目和一个 primary skill。'],
    security: ['受保护接口必须保留鉴权和权限控制；不通过移除鉴权规避测试。'],
    ux: ['中台和客户端遵循现有项目交互与组件规范。'],
    performance: [],
    quality: ['PRD 和 task-plan 必须人工确认后才能进入自动执行。'],
  };
  const requirementGoals = normalizeTextItems(requirements?.goals, 'G');
  const requirementNonGoals = normalizeTextItems(requirements?.nonGoals, 'NG');
  const requirementPersonas = normalizePersonas(requirements?.personas);
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
    goals: requirementGoals.length > 0 ? requirementGoals : [
      {
        id: 'G-001',
        text: goal,
      },
    ],
    nonGoals: requirementNonGoals.length > 0 ? requirementNonGoals : [
      {
        id: 'NG-001',
        text: nonGoal,
      },
    ],
    personas: requirementPersonas.length > 0 ? requirementPersonas : [
      {
        id: 'user',
        name: '目标用户',
        description: '需要使用该功能完成业务流程的用户。',
      },
    ],
    userStories: stories,
    businessRules: normalizeBusinessRules(requirements?.businessRules),
    dataEntities: normalizeDataEntities(requirements?.dataEntities),
    permissions: normalizePermissions(requirements?.permissions, bases),
    openQuestions: normalizeOpenQuestions(requirements?.openQuestions),
    assumptions: normalizeTextItems(requirements?.assumptions, 'ASM'),
    constraints: mergeConstraints(defaultConstraints, requirements),
    risks: normalizeRisks(requirements?.risks),
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

function validatePrdSchema(prd, outputPath) {
  const schemaPath = path.resolve(repoRoot, 'schemas/prd.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const errors = validateSchema(prd, schema, {
    file: path.resolve(repoRoot, outputPath),
    rootSchema: schema,
  });
  if (errors.length === 0) return;

  const details = errors
    .map((item) => `${item.path}: ${item.message}`)
    .join('\n');
  throw new Error(`PRD schema validation failed\n${details}`);
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
    validatePrdSchema(prd, args.out);
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
