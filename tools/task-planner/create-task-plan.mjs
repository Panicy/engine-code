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

function usage() {
  return [
    '用法：node tools/task-planner/create-task-plan.mjs \\',
    '  --project <project.json> \\',
    '  --prd <prd.json> \\',
    '  --out <task-plan.json>',
    '',
    '可选：',
    '  --plan-id PLAN-XXX',
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
  return bases.map((baseId) => byBaseId.get(baseId));
}

function findSkill(registry, templateId, taskType) {
  const preferred = defaultSkillByTemplate[templateId];
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

function taskTitle(story, taskType) {
  const label = {
    backend: '后端实现',
    middle: '中台实现',
    client: '客户端实现',
  }[taskType] ?? '实现';
  return `${story.title}${label}`;
}

function taskScope(story, taskType) {
  const commonOutOfScope = ['不修改 PRD 未确认的需求边界', '不处理当前用户故事之外的额外功能'];
  if (taskType === 'backend') {
    return {
      summary: `围绕用户故事“${story.title}”完成后端接口、权限、数据和必要 SQL。`,
      inScope: ['后端接口', '业务校验', '权限标识', '必要数据库变更', '接口连通性自查'],
      outOfScope: ['中台页面', '客户端页面', ...commonOutOfScope],
    };
  }
  if (taskType === 'middle') {
    return {
      summary: `围绕用户故事“${story.title}”完成中台 API 封装和管理页面。`,
      inScope: ['API 封装', '列表或表单页面', '按钮权限', '类型检查'],
      outOfScope: ['后端接口实现', '客户端页面', ...commonOutOfScope],
    };
  }
  return {
    summary: `围绕用户故事“${story.title}”完成客户端页面流程。`,
    inScope: ['客户端 API 调用', '页面流程', '状态处理', '错误态和鉴权边界'],
    outOfScope: ['后端接口实现', '中台页面', ...commonOutOfScope],
  };
}

function buildTask({ id, story, base, templateInfo, dependencyIds }) {
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
    scope: taskScope(story, taskType),
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
    humanNotes: '',
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

  const storyGroups = (prd.userStories ?? []).map((story) => {
    const tasks = [];
    let backendTaskId = null;

    for (const base of bases) {
      if (!templateCache.has(base.templateId)) {
        templateCache.set(base.templateId, loadTemplate(base.templateId, templatesDir));
      }
      const templateInfo = templateCache.get(base.templateId);
      const taskType = defaultTaskTypeByTemplate[base.templateId] ?? templateInfo.template.type;
      const taskId = `TASK-${String(taskCounter).padStart(3, '0')}`;
      taskCounter += 1;

      const dependencyIds = [];
      if ((taskType === 'middle' || taskType === 'client') && backendTaskId) {
        dependencyIds.push(backendTaskId);
      }

      const task = buildTask({ id: taskId, story, base, templateInfo, dependencyIds });
      if (taskType === 'backend') backendTaskId = taskId;
      tasks.push(task);
    }

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
    const taskCount = taskPlan.storyGroups.reduce((sum, group) => sum + group.tasks.length, 0);
    console.log(JSON.stringify({
      ok: true,
      outputPath,
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

export { buildTaskPlan };
