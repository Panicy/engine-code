#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const schemaFiles = {
  workspace: 'schemas/workspace.schema.json',
  project: 'schemas/project.schema.json',
  prd: 'schemas/prd.schema.json',
  taskPlan: 'schemas/task-plan.schema.json',
  runState: 'schemas/run-state.schema.json',
  template: 'schemas/template.schema.json',
  skills: 'schemas/skills.schema.json',
};

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

function usage() {
  return [
    '用法：node tools/validator/validate-feature.mjs \\',
    '  --project <project.json> \\',
    '  --prd <prd.json> \\',
    '  --task-plan <task-plan.json> \\',
    '  --run-state <run-state.json> \\',
    '  [--workspace <workspace.json>] \\',
    '  [--templates-dir .engine/templates]',
  ].join('\n');
}

function readJson(filePath) {
  const abs = path.resolve(repoRoot, filePath);
  try {
    return {
      ok: true,
      path: abs,
      value: JSON.parse(fs.readFileSync(abs, 'utf8')),
    };
  } catch (error) {
    return {
      ok: false,
      path: abs,
      error,
    };
  }
}

function issue(level, code, file, jsonPath, message, suggestion = '') {
  return { level, code, file, path: jsonPath, message, suggestion };
}

function createReport() {
  return { valid: true, errors: [], warnings: [], infos: [] };
}

function addIssue(report, item) {
  if (item.level === 'error') report.errors.push(item);
  else if (item.level === 'warning') report.warnings.push(item);
  else report.infos.push(item);
  report.valid = report.errors.length === 0;
}

function schemaPath(name) {
  return path.resolve(repoRoot, schemaFiles[name]);
}

function loadSchema(name) {
  return JSON.parse(fs.readFileSync(schemaPath(name), 'utf8'));
}

function dataType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
}

function pointer(base, key) {
  if (base === '$') return `${base}.${key}`;
  return `${base}.${key}`;
}

function validateSchema(value, schema, ctx, jsonPath = '$') {
  const errors = [];

  function fail(code, message, suggestion = '') {
    errors.push(issue('error', code, ctx.file, jsonPath, message, suggestion));
  }

  if (!schema || typeof schema !== 'object') return errors;

  if (schema.$ref) {
    const refSchema = resolveRef(ctx.rootSchema, schema.$ref);
    return validateSchema(value, refSchema, ctx, jsonPath);
  }

  if (schema.anyOf) {
    const anyOk = schema.anyOf.some((child) => validateSchema(value, child, ctx, jsonPath).length === 0);
    if (!anyOk) fail('SCHEMA_ANYOF_FAILED', '字段不满足 anyOf 中任一结构。');
    return errors;
  }

  if (schema.allOf) {
    for (const child of schema.allOf) {
      errors.push(...validateSchema(value, child, ctx, jsonPath));
    }
  }

  if (schema.if) {
    const matches = validateSchema(value, schema.if, ctx, jsonPath).length === 0;
    if (matches && schema.then) {
      errors.push(...validateSchema(value, schema.then, ctx, jsonPath));
    }
    if (!matches && schema.else) {
      errors.push(...validateSchema(value, schema.else, ctx, jsonPath));
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    fail('SCHEMA_CONST_MISMATCH', `字段值必须为 ${JSON.stringify(schema.const)}。`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    fail('SCHEMA_ENUM_MISMATCH', `字段值 ${JSON.stringify(value)} 不在允许范围内。`, `允许值：${schema.enum.join(', ')}`);
  }

  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = dataType(value);
    if (!allowed.includes(actual)) {
      fail('SCHEMA_TYPE_MISMATCH', `字段类型应为 ${allowed.join(' 或 ')}，实际为 ${actual}。`);
      return errors;
    }
  }

  const actualType = dataType(value);

  if (actualType === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      fail('SCHEMA_MIN_LENGTH', `字符串长度不能小于 ${schema.minLength}。`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      fail('SCHEMA_PATTERN_MISMATCH', `字段值不符合格式：${schema.pattern}`);
    }
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
      fail('SCHEMA_DATE_TIME_INVALID', '字段必须是合法 date-time。');
    }
    if (schema.format === 'uri') {
      try {
        new URL(value);
      } catch {
        fail('SCHEMA_URI_INVALID', '字段必须是合法 URI。');
      }
    }
  }

  if (actualType === 'number' || actualType === 'integer') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      fail('SCHEMA_MINIMUM', `数值不能小于 ${schema.minimum}。`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      fail('SCHEMA_MAXIMUM', `数值不能大于 ${schema.maximum}。`);
    }
  }

  if (actualType === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      fail('SCHEMA_MIN_ITEMS', `数组长度不能小于 ${schema.minItems}。`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateSchema(item, schema.items, ctx, `${jsonPath}[${index}]`));
      });
    }
  }

  if (actualType === 'object') {
    const required = schema.required ?? [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(issue('error', 'SCHEMA_REQUIRED_MISSING', ctx.file, pointer(jsonPath, key), `缺少必填字段 ${key}。`));
      }
    }

    const properties = schema.properties ?? {};
    const patternProperties = schema.patternProperties ?? {};
    for (const [key, child] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(...validateSchema(value[key], child, ctx, pointer(jsonPath, key)));
      }
    }

    for (const [key, childValue] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) continue;
      const patternMatch = Object.entries(patternProperties).find(([pattern]) => new RegExp(pattern).test(key));
      if (patternMatch) {
        errors.push(...validateSchema(childValue, patternMatch[1], ctx, pointer(jsonPath, key)));
        continue;
      }
      if (schema.additionalProperties === false) {
        errors.push(issue('error', 'SCHEMA_ADDITIONAL_PROPERTY', ctx.file, pointer(jsonPath, key), `不允许的额外字段 ${key}。`));
      } else if (typeof schema.additionalProperties === 'object') {
        errors.push(...validateSchema(childValue, schema.additionalProperties, ctx, pointer(jsonPath, key)));
      }
    }
  }

  return errors;
}

function resolveRef(rootSchema, ref) {
  if (!ref.startsWith('#/')) {
    throw new Error(`暂不支持外部 $ref：${ref}`);
  }
  return ref
    .slice(2)
    .split('/')
    .reduce((current, part) => current?.[part], rootSchema);
}

function validateWithSchema(report, name, data, file) {
  const schema = loadSchema(name);
  const errors = validateSchema(data, schema, { file, rootSchema: schema });
  errors.forEach((item) => addIssue(report, item));
}

function uniqueBy(items, getKey) {
  const seen = new Map();
  const duplicates = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) duplicates.push(key);
    seen.set(key, item);
  }
  return { map: seen, duplicates };
}

function flattenTasks(taskPlan) {
  const tasks = [];
  for (const [storyIndex, storyGroup] of (taskPlan.storyGroups ?? []).entries()) {
    for (const [taskIndex, task] of (storyGroup.tasks ?? []).entries()) {
      tasks.push({ ...task, _storyId: storyGroup.storyId, _path: `$.storyGroups[${storyIndex}].tasks[${taskIndex}]` });
    }
  }
  return tasks;
}

function collectTemplateRegistries(report, templatesDir) {
  const absDir = path.resolve(repoRoot, templatesDir);
  const templates = new Map();
  const skillsByTemplate = new Map();
  if (!fs.existsSync(absDir)) return { templates, skillsByTemplate };

  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(absDir, entry.name);
    const templatePath = path.join(dir, 'template.json');
    const skillsPath = path.join(dir, 'skills.json');
    if (fs.existsSync(templatePath)) {
      try {
        const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
        validateSchema(template, loadSchema('template'), { file: templatePath, rootSchema: loadSchema('template') })
          .forEach((item) => addIssue(report, item));
        templates.set(template.templateId, { template, path: templatePath });
      } catch (error) {
        addIssue(report, issue('error', 'TEMPLATE_JSON_READ_FAILED', templatePath, '$', `读取或解析模板失败：${error.message}`));
      }
    }
    if (fs.existsSync(skillsPath)) {
      try {
        const registry = JSON.parse(fs.readFileSync(skillsPath, 'utf8'));
        validateSchema(registry, loadSchema('skills'), { file: skillsPath, rootSchema: loadSchema('skills') })
          .forEach((item) => addIssue(report, item));
        const skillMap = new Map();
        for (const skill of registry.skills ?? []) skillMap.set(skill.id, skill);
        skillsByTemplate.set(registry.registryId, { registry, skills: skillMap, path: skillsPath });
      } catch (error) {
        addIssue(report, issue('error', 'SKILLS_JSON_READ_FAILED', skillsPath, '$', `读取或解析 skills 失败：${error.message}`));
      }
    }
  }
  return { templates, skillsByTemplate };
}

function validateReferences(report, data, files, options) {
  const { project, prd, taskPlan, runState, workspace } = data;
  const templatesDir = options.templatesDir ?? '.engine/templates';
  const { templates, skillsByTemplate } = collectTemplateRegistries(report, templatesDir);
  const projectBases = uniqueBy(project.bases ?? [], (base) => base.baseId);
  const prdStories = uniqueBy(prd.userStories ?? [], (story) => story.id);
  const tasks = flattenTasks(taskPlan);
  const taskIndex = uniqueBy(tasks, (task) => task.id);

  for (const duplicate of projectBases.duplicates) {
    addIssue(report, issue('error', 'PROJECT_BASE_DUPLICATED', files.project, '$.bases', `baseId=${duplicate} 重复。`));
  }
  for (const duplicate of prdStories.duplicates) {
    addIssue(report, issue('error', 'PRD_STORY_DUPLICATED', files.prd, '$.userStories', `用户故事 ${duplicate} 重复。`));
  }
  for (const duplicate of taskIndex.duplicates) {
    addIssue(report, issue('error', 'TASK_ID_DUPLICATED', files.taskPlan, '$.storyGroups', `任务 ${duplicate} 重复。`));
  }

  if (workspace) {
    const workspaceTemplates = new Set((workspace.templates ?? []).map((item) => item.templateId));
    const workspaceProjects = new Set((workspace.projects ?? []).map((item) => item.projectId));
    for (const base of project.bases ?? []) {
      if (!workspaceTemplates.has(base.templateId)) {
        addIssue(report, issue('error', 'WORKSPACE_TEMPLATE_NOT_REGISTERED', files.project, '$.bases', `templateId=${base.templateId} 未在 workspace.templates 中登记。`));
      }
    }
    if (!workspaceProjects.has(project.projectId)) {
      addIssue(report, issue('warning', 'WORKSPACE_PROJECT_NOT_REGISTERED', files.project, '$.projectId', `projectId=${project.projectId} 未在 workspace.projects 中登记。`));
    }
  }

  for (const base of project.bases ?? []) {
    if (!templates.has(base.templateId)) {
      addIssue(report, issue('error', 'TEMPLATE_NOT_FOUND', files.project, '$.bases', `templateId=${base.templateId} 找不到模板配置。`, `请检查 ${templatesDir}/${base.templateId}/template.json`));
    }
    if (!skillsByTemplate.has(base.templateId)) {
      addIssue(report, issue('error', 'SKILLS_NOT_FOUND', files.project, '$.bases', `templateId=${base.templateId} 找不到 skills.json。`, `请检查 ${templatesDir}/${base.templateId}/skills.json`));
    }
  }

  if (taskPlan.prdId !== prd.prdId) {
    addIssue(report, issue('error', 'PLAN_PRD_MISMATCH', files.taskPlan, '$.prdId', `task-plan.prdId=${taskPlan.prdId} 与 prd.prdId=${prd.prdId} 不一致。`));
  }
  if (runState.prdId !== prd.prdId) {
    addIssue(report, issue('error', 'RUN_PRD_MISMATCH', files.runState, '$.prdId', `run-state.prdId=${runState.prdId} 与 prd.prdId=${prd.prdId} 不一致。`));
  }
  if (runState.planId !== taskPlan.planId) {
    addIssue(report, issue('error', 'RUN_PLAN_MISMATCH', files.runState, '$.planId', `run-state.planId=${runState.planId} 与 task-plan.planId=${taskPlan.planId} 不一致。`));
  }

  for (const baseId of prd.impactedBaseIds ?? []) {
    if (!projectBases.map.has(baseId)) {
      addIssue(report, issue('error', 'PRD_BASE_NOT_FOUND', files.prd, '$.impactedBaseIds', `PRD impactedBaseIds 中的 ${baseId} 不存在于 project.bases。`));
    }
  }

  for (const [storyIndex, storyGroup] of (taskPlan.storyGroups ?? []).entries()) {
    if (!prdStories.map.has(storyGroup.storyId)) {
      addIssue(report, issue('error', 'STORY_NOT_FOUND', files.taskPlan, `$.storyGroups[${storyIndex}].storyId`, `storyId=${storyGroup.storyId} 不存在于 PRD userStories。`));
    }
    const acceptanceIds = uniqueBy(storyGroup.acceptanceChecks ?? [], (check) => check.id);
    for (const duplicate of acceptanceIds.duplicates) {
      addIssue(report, issue('error', 'ACCEPTANCE_CHECK_DUPLICATED', files.taskPlan, `$.storyGroups[${storyIndex}].acceptanceChecks`, `验收检查 ${duplicate} 重复。`));
    }
  }

  for (const task of tasks) {
    const base = projectBases.map.get(task.targetBaseId);
    if (!base) {
      addIssue(report, issue('error', 'TASK_BASE_NOT_FOUND', files.taskPlan, `${task._path}.targetBaseId`, `targetBaseId=${task.targetBaseId} 不存在。`));
      continue;
    }

    for (const storyId of task.sourceStoryIds ?? []) {
      if (!prdStories.map.has(storyId)) {
        addIssue(report, issue('error', 'TASK_STORY_NOT_FOUND', files.taskPlan, `${task._path}.sourceStoryIds`, `任务引用的用户故事 ${storyId} 不存在。`));
      }
    }

    const registry = skillsByTemplate.get(base.templateId);
    const skill = registry?.skills.get(task.requiredSkillId);
    if (registry && !skill) {
      addIssue(report, issue('error', 'TASK_SKILL_NOT_FOUND', files.taskPlan, `${task._path}.requiredSkillId`, `requiredSkillId=${task.requiredSkillId} 不存在于 ${base.templateId}/skills.json。`));
    }
    if (skill) {
      const allowedTaskTypes = skill.appliesTo?.taskTypes ?? [];
      if (!allowedTaskTypes.includes(task.type)) {
        addIssue(report, issue(
          'error',
          'TASK_SKILL_TYPE_MISMATCH',
          files.taskPlan,
          `${task._path}.requiredSkillId`,
          `任务 ${task.id} 的 type=${task.type} 不适用于 skill ${task.requiredSkillId}。`,
          `允许的 taskTypes：${allowedTaskTypes.join(', ')}`
        ));
      }
    }

    for (const dependency of task.dependsOn ?? []) {
      if (dependency === task.id) {
        addIssue(report, issue('error', 'TASK_DEPENDS_ON_SELF', files.taskPlan, `${task._path}.dependsOn`, `任务 ${task.id} 不能依赖自己。`));
      }
      if (!taskIndex.map.has(dependency)) {
        addIssue(report, issue('error', 'TASK_DEPENDENCY_NOT_FOUND', files.taskPlan, `${task._path}.dependsOn`, `任务 ${task.id} 依赖的 ${dependency} 不存在。`));
      }
    }

    const checkIds = uniqueBy(task.checks ?? [], (check) => check.id);
    for (const duplicate of checkIds.duplicates) {
      addIssue(report, issue('error', 'TASK_CHECK_DUPLICATED', files.taskPlan, `${task._path}.checks`, `任务 ${task.id} 的 check ${duplicate} 重复。`));
    }
    for (const [checkIndex, check] of (task.checks ?? []).entries()) {
      if (check.baseId != null && !projectBases.map.has(check.baseId)) {
        addIssue(report, issue('error', 'CHECK_BASE_NOT_FOUND', files.taskPlan, `${task._path}.checks[${checkIndex}].baseId`, `check.baseId=${check.baseId} 不存在。`));
      }
      if (check.http?.authMode === 'auth_disabled' && (!check.http.teardownCommands || check.http.teardownCommands.length === 0)) {
        addIssue(report, issue('error', 'AUTH_DISABLED_TEARDOWN_REQUIRED', files.taskPlan, `${task._path}.checks[${checkIndex}].http.teardownCommands`, 'auth_disabled 检查必须配置 teardownCommands 恢复鉴权。'));
      }
    }
  }

  validateRunStateConsistency(report, { tasks, taskIndex, runState, files });
}

function validateApprovals(report, data, files) {
  const { prd, taskPlan } = data;
  const openQuestions = (prd.openQuestions ?? []).filter((question) => question.status === 'open');
  if (openQuestions.length > 0 && (prd.status === 'approved' || prd.humanApproval?.approved === true)) {
    addIssue(report, issue('error', 'PRD_APPROVED_WITH_OPEN_QUESTIONS', files.prd, '$.openQuestions', `PRD 已确认但仍存在未关闭问题：${openQuestions.map((item) => item.id).join(', ')}。`));
  }
  if (prd.status !== 'approved' || prd.humanApproval?.approved !== true) {
    addIssue(report, issue('error', 'PRD_NOT_APPROVED', files.prd, '$.humanApproval.approved', 'PRD 尚未人工确认，不能进入自动执行。'));
  }
  if (taskPlan.status !== 'approved' || taskPlan.humanApproval?.approved !== true) {
    addIssue(report, issue('error', 'TASK_PLAN_NOT_APPROVED', files.taskPlan, '$.humanApproval.approved', 'task-plan 尚未人工确认，不能进入 Run Loop。'));
  }
}

function validateRunStateConsistency(report, { tasks, taskIndex, runState, files }) {
  const states = runState.taskStates ?? {};
  const taskIds = new Set(tasks.map((task) => task.id));
  for (const taskId of taskIds) {
    if (!Object.prototype.hasOwnProperty.call(states, taskId)) {
      addIssue(report, issue('error', 'RUN_STATE_TASK_MISSING', files.runState, '$.taskStates', `run-state.taskStates 缺少 ${taskId}。`));
    }
  }
  for (const taskId of Object.keys(states)) {
    if (!taskIds.has(taskId)) {
      addIssue(report, issue('error', 'RUN_STATE_TASK_UNKNOWN', files.runState, `$.taskStates.${taskId}`, `run-state.taskStates 中的 ${taskId} 不存在于 task-plan。`));
    }
  }

  for (const task of tasks) {
    const state = states[task.id];
    if (!state) continue;
    const depStates = (task.dependsOn ?? []).map((dep) => states[dep]?.status);
    const depsDone = depStates.every((status) => status === 'done');
    if (state.status === 'ready' && !depsDone) {
      addIssue(report, issue('error', 'READY_DEPENDENCY_NOT_DONE', files.runState, `$.taskStates.${task.id}.status`, `任务 ${task.id} 为 ready，但依赖尚未全部 done。`));
    }
    if (state.status === 'pending' && depsDone) {
      addIssue(report, issue('warning', 'TASK_CAN_BECOME_READY', files.runState, `$.taskStates.${task.id}.status`, `任务 ${task.id} 的依赖已完成，Run Loop 可将其转为 ready。`));
    }
    if ((state.status === 'checks_failed' || state.status === 'review_failed') && !state.lastIssue) {
      addIssue(report, issue('error', 'FAILED_TASK_MISSING_LAST_ISSUE', files.runState, `$.taskStates.${task.id}.lastIssue`, `任务 ${task.id} 为 ${state.status}，但缺少 lastIssue。`));
    }
    if ((state.status === 'checks_failed' || state.status === 'review_failed') && state.maxAttempts && state.attempts >= state.maxAttempts) {
      addIssue(report, issue('warning', 'TASK_RETRY_EXHAUSTED', files.runState, `$.taskStates.${task.id}.attempts`, `任务 ${task.id} 已达到 maxAttempts，Run Loop 应转为 needs_human。`));
    }
    if (state.status === 'done') {
      const hasReviewArtifact = (runState.artifacts ?? []).some((artifact) => artifact.type === 'review' && artifact.path.includes(task.id));
      if (!hasReviewArtifact) {
        addIssue(report, issue('warning', 'DONE_TASK_REVIEW_NOT_FOUND', files.runState, `$.taskStates.${task.id}.status`, `任务 ${task.id} 已 done，但 run-state.artifacts 中未找到 review 产物。`));
      }
    }
  }

  if (runState.currentTaskId && !taskIndex.map.has(runState.currentTaskId)) {
    addIssue(report, issue('error', 'CURRENT_TASK_NOT_FOUND', files.runState, '$.currentTaskId', `currentTaskId=${runState.currentTaskId} 不存在于 task-plan。`));
  }

  if (runState.activeRunLock) {
    const expiresAt = Date.parse(runState.activeRunLock.expiresAt);
    if (!Number.isNaN(expiresAt) && expiresAt < Date.now()) {
      addIssue(report, issue('warning', 'RUN_LOCK_EXPIRED', files.runState, '$.activeRunLock', '运行锁已过期，可能存在 stale running。'));
    }
  }
}

function validateFiles(input) {
  const report = createReport();
  const files = {
    workspace: input.workspace,
    project: input.project,
    prd: input.prd,
    taskPlan: input['task-plan'],
    runState: input['run-state'],
  };

  const requiredFiles = ['project', 'prd', 'taskPlan', 'runState'];
  const loaded = {};

  if (files.workspace) {
    const result = readJson(files.workspace);
    if (!result.ok) addIssue(report, issue('error', 'JSON_READ_FAILED', files.workspace, '$', `读取或解析 JSON 失败：${result.error.message}`));
    else loaded.workspace = result.value;
  }

  for (const key of requiredFiles) {
    if (!files[key]) {
      addIssue(report, issue('error', 'VALIDATOR_INPUT_MISSING', '', '$', `缺少输入文件：${key}`));
      continue;
    }
    const result = readJson(files[key]);
    if (!result.ok) {
      addIssue(report, issue('error', 'JSON_READ_FAILED', files[key], '$', `读取或解析 JSON 失败：${result.error.message}`));
    } else {
      loaded[key] = result.value;
    }
  }

  if (report.errors.length > 0) return report;

  if (loaded.workspace) validateWithSchema(report, 'workspace', loaded.workspace, files.workspace);
  validateWithSchema(report, 'project', loaded.project, files.project);
  validateWithSchema(report, 'prd', loaded.prd, files.prd);
  validateWithSchema(report, 'taskPlan', loaded.taskPlan, files.taskPlan);
  validateWithSchema(report, 'runState', loaded.runState, files.runState);

  if (report.errors.length === 0) {
    validateApprovals(report, loaded, files);
    validateReferences(report, loaded, files, { templatesDir: input['templates-dir'] });
  }

  report.valid = report.errors.length === 0;
  return report;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }
  if (args.help) {
    console.log(usage());
    return;
  }
  const report = validateFiles(args);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.valid ? 0 : 1);
}

if (process.argv[1] && __filename === path.resolve(process.argv[1])) {
  main();
}

export { validateFiles, validateSchema };
