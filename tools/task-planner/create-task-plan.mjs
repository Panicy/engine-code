#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const defaultSkillByTemplate = {
  'backend-starter': 'ruoyi-module-crud',
  'middle-starter': 'vben-table-form-page',
  'uniapp-template': 'uniapp-page-flow',
};

const defaultTaskTypeByTemplate = {
  'backend-starter': 'backend',
  'middle-starter': 'middle',
  'uniapp-template': 'client',
};

const baseSortOrder = {
  backend: 10,
  middle: 20,
  client: 30,
};

function usage() {
  return [
    '用法：node tools/task-planner/create-task-plan.mjs \\',
    '  --project <project.json> \\',
    '  --prd <prd.json> \\',
    '  --out <task-plan.json>',
    '',
    '可选：',
    '  --plan-id PLAN-XXX',
    '  --run-state-out <run-state.json>',
    '  --templates-dir .engine/templates',
    '  --bases backend,middle,client',
    '  --allow-draft-prd',
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
    if (arg === '--force' || arg === '--allow-draft-prd') {
      args[arg.slice(2)] = true;
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

function splitCsv(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function nowIso() {
  return new Date().toISOString();
}

function toPlanId(prdId) {
  return prdId.replace(/^PRD-/, 'PLAN-');
}

function loadTemplate(templateId, templatesDir) {
  const templatePath = path.resolve(repoRoot, templatesDir, templateId, 'template.json');
  const skillsPath = path.resolve(repoRoot, templatesDir, templateId, 'skills.json');
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const registry = JSON.parse(fs.readFileSync(skillsPath, 'utf8'));
  return { template, registry };
}

function resolveBases(project, prd, args) {
  const requested = args.bases ? splitCsv(args.bases) : (prd.impactedBaseIds ?? []);
  const byBaseId = new Map((project.bases ?? []).map((base) => [base.baseId, base]));
  const bases = requested.length > 0 ? requested : [...byBaseId.keys()];
  const unknown = bases.filter((baseId) => !byBaseId.has(baseId));
  if (unknown.length > 0) {
    throw new Error(`任务拆分包含 project 中不存在的 baseId：${unknown.join(', ')}`);
  }
  return bases
    .map((baseId) => byBaseId.get(baseId))
    .sort((a, b) => {
      const aType = defaultTaskTypeByTemplate[a.templateId] ?? a.templateId;
      const bType = defaultTaskTypeByTemplate[b.templateId] ?? b.templateId;
      return (baseSortOrder[aType] ?? 100) - (baseSortOrder[bType] ?? 100);
    });
}

function findSkill(registry, templateId, taskType, preferredSkillId = '') {
  const preferred = preferredSkillId || defaultSkillByTemplate[templateId];
  if (preferred && (registry.skills ?? []).some((skill) => skill.id === preferred)) return preferred;
  const matched = (registry.skills ?? []).find((skill) => (skill.appliesTo?.taskTypes ?? []).includes(taskType));
  if (matched) return matched.id;
  throw new Error(`模板 ${templateId} 找不到适用于 ${taskType} 的 skill`);
}

function allowedPathsForSkill(registry, skillId, template) {
  const skill = (registry.skills ?? []).find((item) => item.id === skillId);
  const paths = skill?.appliesTo?.paths ?? [];
  if (paths.length > 0) return paths;
  return template.pathPolicy?.defaultAllowedPaths ?? ['**'];
}

function checksForBase(template, baseId) {
  return (template.defaultChecks ?? []).map((check) => ({
    ...check,
    baseId,
  }));
}

function summarizeItems(title, items, render) {
  if (!items || items.length === 0) return [];
  return [`${title}:`, ...items.map(render)];
}

function taskTitle(story, taskType) {
  const label = {
    backend: '后端实现',
    middle: '中台实现',
    client: '客户端实现',
  }[taskType] ?? '实现';
  return `${story.title}${label}`;
}

function taskScope(story, taskType, prd) {
  const commonOutOfScope = ['不修改 PRD 未确认的需求边界', '不处理当前用户故事之外的额外功能'];
  const rules = summarizeItems('业务规则', prd.businessRules, (item) => `${item.id} ${item.text}`);
  const entities = summarizeItems('数据对象', prd.dataEntities, (entity) => {
    const fields = (entity.fields ?? []).map((field) => `${field.name}:${field.type}${field.required ? ':required' : ''}`).join(', ');
    return `${entity.id} ${entity.name} - ${entity.description}${fields ? ` (${fields})` : ''}`;
  });
  const permissions = summarizeItems('权限要求', prd.permissions, (item) => `${item.code} ${item.name}`);
  if (taskType === 'backend') {
    return {
      summary: `围绕用户故事“${story.title}”完成后端接口、权限、数据和必要 SQL。`,
      inScope: ['后端接口', '业务校验', '权限标识', '必要数据库变更', '接口连通性自查', ...entities, ...rules, ...permissions],
      outOfScope: ['中台页面', '客户端页面', ...commonOutOfScope],
    };
  }
  if (taskType === 'middle') {
    return {
      summary: `围绕用户故事“${story.title}”完成中台 API 封装和管理页面。`,
      inScope: ['API 封装', '列表或表单页面', '按钮权限', '类型检查', ...entities, ...rules, ...permissions],
      outOfScope: ['后端接口实现', '客户端页面', ...commonOutOfScope],
    };
  }
  return {
    summary: `围绕用户故事“${story.title}”完成客户端页面流程。`,
    inScope: ['客户端 API 调用', '页面流程', '状态处理', '错误态和鉴权边界', ...entities, ...rules],
    outOfScope: ['后端接口实现', '中台页面', ...commonOutOfScope],
  };
}

function buildHumanNotes(prd) {
  const assumptions = summarizeItems('默认假设', prd.assumptions, (item) => `${item.id} ${item.text}`);
  const openQuestions = summarizeItems('待确认问题', prd.openQuestions, (item) => `${item.id} ${item.question}`);
  const risks = summarizeItems('风险', prd.risks, (item) => `${item.id} ${item.description}；缓解：${item.mitigation}`);
  return [...assumptions, ...openQuestions, ...risks].join('\n');
}

function buildTask({ id, story, base, templateInfo, dependencyIds, prd }) {
  const taskType = defaultTaskTypeByTemplate[base.templateId] ?? templateInfo.template.type;
  const skillId = findSkill(templateInfo.registry, base.templateId, taskType);
  return {
    id,
    title: taskTitle(story, taskType),
    type: taskType,
    sourceStoryIds: [story.id],
    targetBaseId: base.baseId,
    dependsOn: dependencyIds,
    requiredSkillId: skillId,
    scope: taskScope(story, taskType, prd),
    allowedPaths: allowedPathsForSkill(templateInfo.registry, skillId, templateInfo.template),
    expectedChangedFiles: [],
    acceptanceCriteria: story.acceptanceCriteria,
    checks: checksForBase(templateInfo.template, base.baseId),
    contextBudget: {
      size: 'm',
      maxFiles: taskType === 'backend' ? 16 : 12,
      maxEstimatedMinutes: 60,
    },
    retryPolicy: {
      maxAttempts: 3,
    },
    humanNotes: buildHumanNotes(prd),
  };
}

function buildSchemaTask({ id, story, base, templateInfo, prd, dependencyIds = [] }) {
  const skillId = findSkill(templateInfo.registry, base.templateId, 'schema', 'ruoyi-database-migration');
  const entities = summarizeItems('数据对象', prd.dataEntities, (entity) => {
    const fields = (entity.fields ?? []).map((field) => `${field.name}:${field.type}${field.required ? ':required' : ''}`).join(', ');
    return `${entity.id} ${entity.name} - ${entity.description}${fields ? ` (${fields})` : ''}`;
  });
  const rules = summarizeItems('业务规则', prd.businessRules, (item) => `${item.id} ${item.text}`);
  const permissions = summarizeItems('权限要求', prd.permissions, (item) => `${item.code} ${item.name}`);
  return {
    id,
    title: `${story.title}数据库与权限基础`,
    type: 'schema',
    sourceStoryIds: [story.id],
    targetBaseId: base.baseId,
    dependsOn: dependencyIds,
    requiredSkillId: skillId,
    scope: {
      summary: `围绕用户故事“${story.title}”完成数据库、字段、索引、菜单权限 SQL 等基础准备。`,
      inScope: ['业务表 SQL', '字段和索引设计', '菜单权限 SQL', ...entities, ...rules, ...permissions],
      outOfScope: ['后端 CRUD 接口实现', '中台页面', '客户端页面', 'PRD 未确认的字段和规则'],
    },
    allowedPaths: allowedPathsForSkill(templateInfo.registry, skillId, templateInfo.template),
    expectedChangedFiles: [],
    acceptanceCriteria: story.acceptanceCriteria,
    checks: checksForBase(templateInfo.template, base.baseId),
    contextBudget: {
      size: 'm',
      maxFiles: 12,
      maxEstimatedMinutes: 45,
    },
    retryPolicy: {
      maxAttempts: 3,
    },
    humanNotes: buildHumanNotes(prd),
  };
}

function buildTaskPlan(args) {
  requireArg(args, 'project');
  requireArg(args, 'prd');
  requireArg(args, 'out');

  const project = readJson(args.project);
  const prd = readJson(args.prd);
  if ((prd.status !== 'approved' || prd.humanApproval?.approved !== true) && args['allow-draft-prd'] !== true) {
    throw new Error('PRD 尚未人工确认。生成 task-plan 前请先 approve PRD，或仅开发验证时使用 --allow-draft-prd。');
  }

  const templatesDir = args['templates-dir'] ?? '.engine/templates';
  const bases = resolveBases(project, prd, args);
  const templateCache = new Map();
  const timestamp = nowIso();
  let taskCounter = 1;
  const storyTerminalTaskIds = new Map();
  validateStoryDependencies(prd.userStories ?? []);

  const storyGroups = (prd.userStories ?? []).map((story) => {
    const tasks = [];
    let backendTaskId = null;
    const storyDependencyIds = (story.dependencies ?? [])
      .map((storyId) => storyTerminalTaskIds.get(storyId))
      .filter(Boolean);

    for (const base of bases) {
      if (!templateCache.has(base.templateId)) {
        templateCache.set(base.templateId, loadTemplate(base.templateId, templatesDir));
      }
      const templateInfo = templateCache.get(base.templateId);
      const taskType = defaultTaskTypeByTemplate[base.templateId] ?? templateInfo.template.type;
      let schemaTaskId = null;
      if (taskType === 'backend' && (prd.dataEntities ?? []).length > 0) {
        schemaTaskId = `TASK-${String(taskCounter).padStart(3, '0')}`;
        taskCounter += 1;
        tasks.push(buildSchemaTask({ id: schemaTaskId, story, base, templateInfo, prd, dependencyIds: storyDependencyIds }));
      }

      const taskId = `TASK-${String(taskCounter).padStart(3, '0')}`;
      taskCounter += 1;
      const dependencyIds = [];
      if (schemaTaskId) dependencyIds.push(schemaTaskId);
      if (!schemaTaskId && taskType === 'backend') dependencyIds.push(...storyDependencyIds);
      if ((taskType === 'middle' || taskType === 'client') && backendTaskId) dependencyIds.push(backendTaskId);
      if ((taskType === 'middle' || taskType === 'client') && !backendTaskId) dependencyIds.push(...storyDependencyIds);

      const task = buildTask({ id: taskId, story, base, templateInfo, dependencyIds, prd });
      if (taskType === 'backend') backendTaskId = taskId;
      tasks.push(task);
    }
    if (tasks.length > 0) storyTerminalTaskIds.set(story.id, tasks.at(-1).id);

    return {
      storyId: story.id,
      title: story.title,
      tasks,
      acceptanceChecks: [],
    };
  });

  return {
    schemaVersion: '0.1.0',
    planId: args['plan-id'] ?? toPlanId(prd.prdId),
    prdId: prd.prdId,
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
    storyGroups,
    regressionChecks: [],
    humanApproval: {
      approved: false,
      approvedBy: null,
      approvedAt: null,
      notes: '',
    },
  };
}

function flattenTasks(taskPlan) {
  return taskPlan.storyGroups.flatMap((group) => group.tasks);
}

function toRunId(planId) {
  return planId.replace(/^PLAN-/, 'RUN-');
}

function buildRunState(taskPlan, timestamp) {
  const taskStates = {};
  for (const task of flattenTasks(taskPlan)) {
    taskStates[task.id] = {
      status: task.dependsOn.length > 0 ? 'pending' : 'ready',
      attempts: 0,
      maxAttempts: task.retryPolicy.maxAttempts,
      lastRunId: null,
      lastIssue: null,
      updatedAt: timestamp,
    };
  }
  return {
    schemaVersion: '0.1.0',
    runId: toRunId(taskPlan.planId),
    prdId: taskPlan.prdId,
    planId: taskPlan.planId,
    status: 'not_started',
    currentTaskId: null,
    startedAt: null,
    updatedAt: timestamp,
    activeRunLock: null,
    taskStates,
    completedTasks: [],
    artifacts: [],
    decisions: [],
  };
}

function validateStoryDependencies(stories) {
  const knownStoryIds = new Set(stories.map((story) => story.id));
  const previousStoryIds = new Set();
  for (const story of stories) {
    const dependencies = story.dependencies ?? [];
    const unknown = dependencies.filter((storyId) => !knownStoryIds.has(storyId));
    if (unknown.length > 0) {
      throw new Error(`用户故事 ${story.id} 依赖不存在的 storyId：${unknown.join(', ')}`);
    }
    const forward = dependencies.filter((storyId) => !previousStoryIds.has(storyId));
    if (forward.length > 0) {
      throw new Error(`用户故事 ${story.id} 只能依赖排在它之前的用户故事：${forward.join(', ')}`);
    }
    previousStoryIds.add(story.id);
  }
}

function writeJson(filePath, value, force) {
  const abs = path.resolve(repoRoot, filePath);
  if (fs.existsSync(abs) && force !== true) {
    throw new Error(`目标文件已存在，拒绝覆盖：${abs}。如确认覆盖，请使用 --force。`);
  }
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
    const taskPlan = buildTaskPlan(args);
    const outputPath = writeJson(args.out, taskPlan, args.force);
    const runStatePath = args['run-state-out'] ?? path.join(path.dirname(args.out), 'run-state.json');
    const runState = buildRunState(taskPlan, taskPlan.updatedAt);
    const runStateOutputPath = writeJson(runStatePath, runState, args.force);
    const taskCount = taskPlan.storyGroups.reduce((sum, group) => sum + group.tasks.length, 0);
    console.log(JSON.stringify({
      ok: true,
      outputPath,
      runStateOutputPath,
      planId: taskPlan.planId,
      status: taskPlan.status,
      storyCount: taskPlan.storyGroups.length,
      taskCount,
      message: 'task-plan 草稿已生成，需人工确认后才能进入 Run Loop。',
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

export { buildRunState, buildTaskPlan };
