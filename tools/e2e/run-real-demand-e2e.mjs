#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scenarios, smokeScenarioIds } from './real-demand-scenarios/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const sourceTemplatesRoot = path.resolve(repoRoot, '.engine/source-templates');
let lastBaseDir = null;

function usage() {
  return [
    '用法：node tools/e2e/run-real-demand-e2e.mjs',
    '',
    '可选：',
    '  --list-scenarios',
    '  --all',
    `  --scenario ${Object.keys(scenarios).join('|')}`,
    '  --adapter shell|codex',
    '  --codex-command codex',
    '  --keep-tmp',
    '',
    '默认使用 shell adapter，在 /private/tmp 复制真实基座后运行确定性真实需求场景。',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { scenario: 'client-announcement-tags', adapter: 'shell' };
  let hasScenario = false;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--keep-tmp') {
      args.keepTmp = true;
      continue;
    }
    if (arg === '--list-scenarios') {
      args.listScenarios = true;
      continue;
    }
    if (arg === '--all') {
      args.all = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    const key = arg.slice(2);
    if (!['scenario', 'adapter', 'codex-command'].includes(key)) {
      throw new Error(`未知参数：${arg}`);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${arg} 缺少值`);
    if (key === 'scenario') hasScenario = true;
    args[key] = value;
    i += 1;
  }
  if (args.all && hasScenario) {
    throw new Error('--all 不能与 --scenario 同时使用');
  }
  if (!scenarios[args.scenario]) {
    throw new Error(`未知 scenario：${args.scenario}`);
  }
  if (!['shell', 'codex'].includes(args.adapter)) {
    throw new Error(`未知 adapter：${args.adapter}`);
  }
  return args;
}

function listScenarios() {
  return Object.values(scenarios).map((scenario) => ({
    id: scenario.id,
    name: scenario.name,
    templateId: scenario.templateId,
    baseId: scenario.baseId,
    type: scenario.type,
    description: scenario.description,
  }));
}

function runCommand(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });
  if (result.status !== 0) {
    throw new Error([
      `命令失败：${command} ${commandArgs.join(' ')}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function runNode(args, options = {}) {
  return runCommand(process.execPath, args, options);
}

function parseJsonOutput(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`命令输出不是合法 JSON：${error.message}\n${result.stdout}`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertInside(parent, child, message) {
  const parentAbs = path.resolve(parent);
  const childAbs = path.resolve(child);
  const relative = path.relative(parentAbs, childAbs);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), message);
}

function assertScenarioSafe(scenario) {
  assert(!scenario.sourceWorkspace, `scenario ${scenario.id} 不允许指定外部 sourceWorkspace，真实需求 E2E 只能使用登记基座模板。`);
  assert(!scenario.workspace, `scenario ${scenario.id} 不允许指定外部 workspace，workspace 必须由 runner 在临时目录创建。`);
  assert(!scenario.sourcePath, `scenario ${scenario.id} 不允许指定外部 sourcePath，真实需求 E2E 只能复制 .engine/source-templates。`);
}

function sourceTemplatePath(templateId) {
  const sourceTemplate = path.resolve(sourceTemplatesRoot, templateId);
  assertInside(sourceTemplatesRoot, sourceTemplate, `templateId 越界：${templateId}`);
  return sourceTemplate;
}

function copySourceTemplate(templateId, workspace) {
  const sourceTemplate = sourceTemplatePath(templateId);
  assert(fs.existsSync(sourceTemplate), `source template 不存在：${sourceTemplate}`);
  assertInside(sourceTemplatesRoot, sourceTemplate, `source template 必须位于 .engine/source-templates：${sourceTemplate}`);
  fs.cpSync(sourceTemplate, workspace, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}.git${path.sep}`) && !source.endsWith(`${path.sep}.git`),
  });
}

function initGitWorkspace(workspace) {
  runCommand('git', ['init'], { cwd: workspace });
  runCommand('git', ['config', 'user.email', 'real-demand-e2e@example.test'], { cwd: workspace });
  runCommand('git', ['config', 'user.name', 'Real Demand E2E'], { cwd: workspace });
  runCommand('git', ['add', '.'], { cwd: workspace });
  runCommand('git', ['commit', '-m', 'baseline'], { cwd: workspace });
}

function prepareWorkspace(baseDir, scenario) {
  assertScenarioSafe(scenario);
  const workspace = path.join(baseDir, `${scenario.baseId}-workspace`);
  assertInside(baseDir, workspace, `workspace 必须位于真实需求 E2E 临时目录：${workspace}`);
  copySourceTemplate(scenario.templateId, workspace);
  initGitWorkspace(workspace);
  return workspace;
}

function createProject(baseDir, workspace, scenario) {
  const projectPath = path.join(baseDir, 'project.json');
  const result = parseJsonOutput(runNode([
    'tools/project-init/create-project.mjs',
    '--project-id', scenario.projectId,
    '--name', scenario.projectName,
    '--description', scenario.projectDescription,
    '--base', `${scenario.baseId}:${scenario.templateId}:https://example.com/${scenario.baseId}.git:${workspace}`,
    '--out', projectPath,
  ]));
  assert(result.ok === true, 'create-project 应成功');
  assert(fs.existsSync(projectPath), 'project.json 应生成');
  return projectPath;
}

function createFeature(baseDir, projectPath, scenario) {
  const featureDir = path.join(baseDir, 'features', scenario.featureId);
  const result = parseJsonOutput(runNode([
    'tools/project-init/create-feature.mjs',
    '--feature-id', scenario.featureId,
    '--name', scenario.featureName,
    '--summary', scenario.featureSummary,
    '--project', projectPath,
    '--bases', scenario.baseId,
    '--out-dir', featureDir,
    '--approve-prd-by', 'real-e2e',
    '--approve-task-plan-by', 'real-e2e',
  ]));
  assert(result.ok === true, 'create-feature 应成功');
  assert(result.prdApproved === true, 'PRD 应已确认');
  assert(result.taskPlanApproved === true, 'task-plan 应已确认');
  assert(result.validationPassed === true, 'feature 初始化后 validator 应通过');
  return {
    dir: featureDir,
    prd: path.join(featureDir, 'prd.json'),
    taskPlan: path.join(featureDir, 'task-plan.json'),
    runState: path.join(featureDir, 'run-state.json'),
    loopSummary: path.join(featureDir, 'loop-summary.json'),
  };
}

function patchTaskPlan(paths, scenario) {
  const taskPlan = readJson(paths.taskPlan);
  const group = taskPlan.storyGroups[0];
  group.title = scenario.taskTitle;
  group.tasks = [
    {
      id: 'TASK-001',
      title: scenario.taskTitle,
      type: scenario.type,
      sourceStoryIds: [group.storyId],
      targetBaseId: scenario.baseId,
      dependsOn: [],
      requiredSkillId: scenario.requiredSkillId,
      scope: {
        summary: scenario.taskSummary,
        inScope: scenario.inScope,
        outOfScope: scenario.outOfScope,
      },
      allowedPaths: scenario.allowedPaths,
      expectedChangedFiles: scenario.expectedChangedFiles,
      acceptanceCriteria: [
        {
          id: 'AC-001',
          text: scenario.acceptanceText,
          verification: scenario.verification,
        },
      ],
      checks: scenario.checks,
      contextBudget: scenario.contextBudget,
      retryPolicy: {
        maxAttempts: scenario.maxAttempts,
      },
      humanNotes: `Real demand E2E fixture task: ${scenario.id}.`,
    },
  ];
  writeJson(paths.taskPlan, taskPlan);

  const runState = readJson(paths.runState);
  runState.taskStates = {
    'TASK-001': {
      status: 'ready',
      attempts: 0,
      maxAttempts: scenario.maxAttempts,
      lastRunId: null,
      lastIssue: null,
      updatedAt: runState.updatedAt,
    },
  };
  runState.completedTasks = [];
  runState.artifacts = [];
  writeJson(paths.runState, runState);
}

function writeModifierScript(baseDir, scenario) {
  const scriptPath = path.join(baseDir, `${scenario.id}-modifier.mjs`);
  fs.writeFileSync(scriptPath, scenario.modifierScript(), 'utf8');
  return scriptPath;
}

function runLoop(paths, args, scenario, modifierScript) {
  const adapterArgs = args.adapter === 'codex'
    ? ['--agent-adapter', 'codex', '--codex-command', args['codex-command'] ?? 'codex', '--codex-extra-arg', 'exec']
    : ['--agent-adapter', 'shell', '--shell-command', `${process.execPath} ${modifierScript}`];
  return parseJsonOutput(runNode([
    'tools/run-loop/run-feature.mjs',
    '--project', paths.projectPath,
    '--prd', paths.prd,
    '--task-plan', paths.taskPlan,
    '--run-state', paths.runState,
    '--checks-mode', 'real',
    '--max-tasks', '1',
    ...adapterArgs,
  ]));
}

function assertScenario(paths, scenario, adapter, workspace) {
  const taskContextPath = path.join(paths.dir, 'runs', 'TASK-001', 'task-context.json');
  const taskRunPath = path.join(paths.dir, 'runs', 'TASK-001', 'task-run.json');
  const reviewPath = path.join(paths.dir, 'runs', 'TASK-001', 'review.json');
  assert(fs.existsSync(paths.prd), 'PRD 文件应存在');
  assert(fs.existsSync(paths.taskPlan), 'task-plan 文件应存在');
  assert(fs.existsSync(paths.runState), 'run-state 文件应存在');
  assert(fs.existsSync(taskContextPath), 'task-context 文件应存在');
  assert(fs.existsSync(taskRunPath), 'task-run 文件应存在');
  assert(fs.existsSync(reviewPath), 'review 文件应存在');

  const prd = readJson(paths.prd);
  const taskPlan = readJson(paths.taskPlan);
  const taskContext = readJson(taskContextPath);
  const taskRun = readJson(taskRunPath);
  const attempt = taskRun.attempts[0];
  const review = readJson(reviewPath);
  const runState = readJson(paths.runState);
  const loopSummary = readJson(paths.loopSummary);
  const changedFiles = attempt.changedFiles.join(',');
  const expectedChangedFiles = scenario.expectedChangedFiles.join(',');

  assert(prd.status === 'approved' && prd.humanApproval.approved === true, 'PRD 应已确认');
  assert(taskPlan.status === 'approved' && taskPlan.humanApproval.approved === true, 'task-plan 应已确认');
  assert(taskContext.base.baseId === scenario.baseId, `task-context 应指向 ${scenario.baseId} 基座`);
  assert(taskContext.base.templateId === scenario.templateId, `task-context 应指向 ${scenario.templateId} 模板`);
  assert(taskContext.base.workspaceAbs === workspace, 'task-context 应指向临时真实基座副本');
  assert(taskContext.base.workspaceAbs.includes('/engine-real-demand-e2e-'), 'task-context workspace 应位于临时目录');
  assert(taskContext.task.requiredSkillId === scenario.requiredSkillId, 'task-context 应包含任务所需 skill');
  assert(taskContext.executionHints.checks.some((check) => check.id === scenario.checks[0].id), 'task-context 应包含真实检查命令');
  assert(attempt.agent.tool === adapter, `场景应使用 ${adapter} adapter`);
  assert(changedFiles === expectedChangedFiles, `changedFiles 应只来自 git diff：${expectedChangedFiles}`);
  assert(review.verdict === scenario.expectedReview, `review 应为 ${scenario.expectedReview}`);
  assert(runState.taskStates['TASK-001'].status === scenario.expectedStatus, `task 应为 ${scenario.expectedStatus}`);
  assert(loopSummary.status === scenario.expectedLoopStatus, `loop-summary 应为 ${scenario.expectedLoopStatus}`);

  if (scenario.expectedReview === 'pass') {
    assert(attempt.status === 'passed', '正向场景 task-run attempt 应 passed');
    assert(attempt.checks.some((check) => check.id === scenario.checks[0].id && check.status === 'passed'), '正向场景 check 应 passed');
  } else {
    assert(loopSummary.taskSummary[scenario.expectedSummaryKey].includes('TASK-001'), '负向场景 loop-summary 应记录异常任务');
  }

  return {
    status: scenario.expectedReview === 'pass' ? 'passed' : 'passed-negative',
    changedFiles: attempt.changedFiles,
    reviewVerdict: review.verdict,
    runStateStatus: runState.taskStates['TASK-001'].status,
    loopSummaryStatus: loopSummary.status,
  };
}

function runRealDemandE2E(args) {
  const scenario = scenarios[args.scenario];
  assertScenarioSafe(scenario);
  const tmpRoot = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir();
  const baseDir = fs.mkdtempSync(path.join(tmpRoot, 'engine-real-demand-e2e-'));
  lastBaseDir = baseDir;
  const workspace = prepareWorkspace(baseDir, scenario);
  const projectPath = createProject(baseDir, workspace, scenario);
  const paths = createFeature(baseDir, projectPath, scenario);
  paths.projectPath = projectPath;
  patchTaskPlan(paths, scenario);
  const modifierScript = writeModifierScript(baseDir, scenario);
  const loopResult = runLoop(paths, args, scenario, modifierScript);
  const assertion = assertScenario(paths, scenario, args.adapter, workspace);
  return {
    ok: true,
    scenario: scenario.id,
    adapter: args.adapter,
    baseDir,
    workspace,
    projectPath,
    featureDir: paths.dir,
    loopSummaryPath: loopResult.loopSummaryPath,
    assertion,
  };
}

function runScenarioWithCleanup(args) {
  let result;
  try {
    result = runRealDemandE2E(args);
    return result;
  } finally {
    const cleanupDir = result?.baseDir ?? lastBaseDir;
    if (cleanupDir && !args.keepTmp) {
      fs.rmSync(cleanupDir, { recursive: true, force: true });
    }
    lastBaseDir = null;
  }
}

function runAllRealDemandE2E(args) {
  const results = [];
  for (const scenarioId of smokeScenarioIds) {
    results.push(runScenarioWithCleanup({ ...args, scenario: scenarioId }));
  }
  return {
    ok: true,
    mode: 'all',
    scenarioIds: smokeScenarioIds,
    results,
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.listScenarios) {
    console.log(JSON.stringify({ ok: true, scenarios: listScenarios() }, null, 2));
    return;
  }
  const result = args.all ? runAllRealDemandE2E(args) : runScenarioWithCleanup(args);
  console.log(JSON.stringify(result, null, 2));
}

try {
  if (process.argv[1] && __filename === path.resolve(process.argv[1])) {
    main();
  }
} catch (error) {
  console.error(error.message);
  console.error(usage());
  process.exit(1);
}

export { runAllRealDemandE2E, runRealDemandE2E, listScenarios };
