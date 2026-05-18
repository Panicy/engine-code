import fs from 'node:fs';
import path from 'node:path';

function flattenTasks(taskPlan) {
  return taskPlan.storyGroups.flatMap((group) => group.tasks.map((task) => ({
    ...task,
    storyId: group.storyId,
    storyTitle: group.title,
  })));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function resolveSkillDocPath({ templatesDir, templateId, skill }) {
  const templateDir = path.resolve(templatesDir, templateId);
  const fromAddendum = /见\s+([^\s。]+\.md)/.exec(skill.promptAddendum ?? '');
  const relativePath = fromAddendum?.[1] ?? `skills/${skill.id}.md`;
  const fullPath = path.resolve(templateDir, relativePath);
  const relativeToTemplate = path.relative(templateDir, fullPath);
  if (relativeToTemplate.startsWith('..') || path.isAbsolute(relativeToTemplate)) {
    throw new Error(`skill ${skill.id} 文档路径越界：${relativePath}`);
  }
  return fullPath;
}

function prdSliceForTask(prd, task) {
  const storyIds = new Set(task.sourceStoryIds ?? []);
  return {
    prdId: prd.prdId,
    feature: prd.feature,
    goals: prd.goals ?? [],
    nonGoals: prd.nonGoals ?? [],
    userStories: (prd.userStories ?? []).filter((story) => storyIds.has(story.id)),
    businessRules: prd.businessRules ?? [],
    dataEntities: prd.dataEntities ?? [],
    permissions: prd.permissions ?? [],
    assumptions: prd.assumptions ?? [],
    constraints: prd.constraints ?? {},
  };
}

function buildTaskContext({ project, prd, taskPlan, taskId, templatesDir = '.engine/templates', repoRoot = process.cwd() }) {
  const tasks = flattenTasks(taskPlan);
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`task 不存在：${taskId}`);

  const base = (project.bases ?? []).find((item) => item.baseId === task.targetBaseId);
  if (!base) throw new Error(`task ${taskId} 引用的 base 不存在：${task.targetBaseId}`);

  const resolvedTemplatesDir = path.resolve(repoRoot, templatesDir);
  const templateDir = path.join(resolvedTemplatesDir, base.templateId);
  const templatePath = path.join(templateDir, 'template.json');
  const skillsPath = path.join(templateDir, 'skills.json');
  const template = readJson(templatePath);
  const registry = readJson(skillsPath);
  const skill = (registry.skills ?? []).find((item) => item.id === task.requiredSkillId);
  if (!skill) throw new Error(`task ${taskId} 引用的 skill 不存在：${task.requiredSkillId}`);

  const skillDocPath = resolveSkillDocPath({ templatesDir: resolvedTemplatesDir, templateId: base.templateId, skill });
  const skillDocument = readTextIfExists(skillDocPath);
  if (!skillDocument) throw new Error(`skill 文档不存在：${skillDocPath}`);

  const baseWorkspace = path.resolve(repoRoot, base.workspace);
  return {
    schemaVersion: '0.1.0',
    project: {
      projectId: project.projectId,
      name: project.name,
    },
    base: {
      baseId: base.baseId,
      templateId: base.templateId,
      repo: base.repo,
      workspace: base.workspace,
      workspaceAbs: baseWorkspace,
      branch: base.branch ?? '',
      overrides: base.overrides ?? {},
    },
    template: {
      templateId: template.templateId,
      name: template.name,
      type: template.type,
      templatePath,
      defaultAllowedPaths: template.pathPolicy?.defaultAllowedPaths ?? [],
      defaultChecks: template.defaultChecks ?? [],
    },
    prd: prdSliceForTask(prd, task),
    task,
    skill: {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      appliesTo: skill.appliesTo,
      inputsRequired: skill.inputsRequired,
      workflow: skill.workflow,
      qualityGates: skill.qualityGates,
      promptAddendum: skill.promptAddendum ?? '',
      documentPath: skillDocPath,
      document: skillDocument,
    },
    executionHints: {
      allowedPaths: task.allowedPaths,
      expectedChangedFiles: task.expectedChangedFiles ?? [],
      checks: task.checks ?? [],
      retryPolicy: task.retryPolicy,
      contextBudget: task.contextBudget,
      humanNotes: task.humanNotes ?? '',
    },
  };
}

export { buildTaskContext };
