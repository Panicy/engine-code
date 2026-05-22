#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateFiles } from '../validator/validate-feature.mjs';
import { runChecks } from '../checks-runner/index.mjs';
import { runReview } from '../review-runner/index.mjs';
import { availableAgentAdapters } from '../agent-adapters/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const projectPath = '.engine/json/examples/project.json';
const templatesDir = '.engine/templates';

function parseArgs(argv) {
  const args = {};
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
    if (!arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${arg} 缺少值`);
    args[key] = value;
    i += 1;
  }
  return args;
}

function usage() {
  return [
    '用法：node tools/e2e/run-engine-e2e.mjs',
    '',
    '可选：',
    '  --keep-tmp 保留临时测试目录，便于排查产物',
  ].join('\n');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeResult(ok, name, details = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${details ? ` - ${details}` : ''}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (options.expectFailure) {
    if (result.status === 0) {
      throw new Error(`命令预期失败但成功：node ${args.join(' ')}`);
    }
    return result;
  }
  if (result.status !== 0) {
    throw new Error([
      `命令失败：node ${args.join(' ')}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error([
      `命令失败：${command} ${args.join(' ')}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function parseCommandJson(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`命令输出不是合法 JSON：${error.message}\n${result.stdout}`);
  }
}

function listJsonFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listJsonFiles(fullPath));
    if (entry.isFile() && entry.name.endsWith('.json')) files.push(fullPath);
  }
  return files;
}

function validateJsonFixtures() {
  const dirs = ['schemas', '.engine/json', '.engine/templates'].map((item) => path.resolve(repoRoot, item));
  const files = dirs.flatMap(listJsonFiles);
  for (const file of files) readJson(file);
  return `${files.length} 个 JSON 文件`;
}

function featurePaths(baseDir, featureId) {
  const dir = path.join(baseDir, featureId);
  return {
    dir,
    prd: path.join(dir, 'prd.json'),
    taskPlan: path.join(dir, 'task-plan.json'),
    runState: path.join(dir, 'run-state.json'),
    loopSummary: path.join(dir, 'loop-summary.json'),
  };
}

function writeProjectWithWorkspace(baseDir, fileName, workspace) {
  const project = readJson(path.resolve(repoRoot, projectPath));
  project.bases = project.bases.map((base) => ({
    ...base,
    workspace,
  }));
  const outputPath = path.join(baseDir, fileName);
  fs.writeFileSync(outputPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  return outputPath;
}

function initGitWorkspace(workspace, files = {}) {
  fs.mkdirSync(workspace, { recursive: true });
  runCommand('git', ['init'], { cwd: workspace });
  runCommand('git', ['config', 'user.email', 'e2e@example.test'], { cwd: workspace });
  runCommand('git', ['config', 'user.name', 'Engine E2E'], { cwd: workspace });
  for (const [filePath, content] of Object.entries(files)) {
    const abs = path.join(workspace, filePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  fs.writeFileSync(path.join(workspace, '.gitignore'), '.DS_Store\n', 'utf8');
  runCommand('git', ['add', '.'], { cwd: workspace });
  runCommand('git', ['commit', '-m', 'baseline'], { cwd: workspace });
}

function createFeature(baseDir, featureId, options = {}) {
  const paths = featurePaths(baseDir, featureId);
  paths.projectPath = options.projectPath ?? projectPath;
  fs.mkdirSync(paths.dir, { recursive: true });
  parseCommandJson(runNode([
    'tools/prd-builder/create-prd.mjs',
    '--feature-id', featureId,
    '--name', options.name ?? `E2E-${featureId}`,
    '--summary', options.summary ?? `验证 ${featureId} 流程`,
    '--project', paths.projectPath,
    '--bases', options.bases ?? 'backend,middle,client',
    '--out', paths.prd,
    '--force',
  ]));
  return paths;
}

function approvePrd(paths) {
  parseCommandJson(runNode(['tools/prd-builder/approve-prd.mjs', '--prd', paths.prd, '--by', 'e2e']));
}

function createTaskPlan(paths) {
  parseCommandJson(runNode([
    'tools/task-planner/create-task-plan.mjs',
    '--project', paths.projectPath ?? projectPath,
    '--prd', paths.prd,
    '--out', paths.taskPlan,
    '--run-state-out', paths.runState,
    '--force',
  ]));
}

function approveTaskPlan(paths) {
  parseCommandJson(runNode([
    'tools/task-planner/approve-task-plan.mjs',
    '--project', paths.projectPath ?? projectPath,
    '--prd', paths.prd,
    '--task-plan', paths.taskPlan,
    '--run-state', paths.runState,
    '--by', 'e2e',
  ]));
}

function runLoop(paths, extraArgs = []) {
  const normalizedExtraArgs = extraArgs.includes('--checks-mode') ? extraArgs : ['--checks-mode', 'mock', ...extraArgs];
  return parseCommandJson(runNode([
    'tools/run-loop/run-feature.mjs',
    '--project', paths.projectPath ?? projectPath,
    '--prd', paths.prd,
    '--task-plan', paths.taskPlan,
    '--run-state', paths.runState,
    ...normalizedExtraArgs,
  ]));
}

function validateFeature(paths) {
  const report = validateFiles({
    project: paths.projectPath ?? projectPath,
    prd: paths.prd,
    'task-plan': paths.taskPlan,
    'run-state': paths.runState,
    'templates-dir': templatesDir,
  });
  assert(report.valid, `Validator 校验失败：${JSON.stringify(report, null, 2)}`);
  return report;
}

function runProjectInitCreateProject(args, options = {}) {
  return parseCommandJson(runNode(['tools/project-init/create-project.mjs', ...args], options));
}

function runProjectInitCreateFeature(args, options = {}) {
  return parseCommandJson(runNode(['tools/project-init/create-feature.mjs', ...args], options));
}

function runRecoveryListIssues(args, options = {}) {
  return parseCommandJson(runNode(['tools/recovery/list-issues.mjs', ...args], options));
}

function runRecoveryShowTask(args, options = {}) {
  return parseCommandJson(runNode(['tools/recovery/show-task.mjs', ...args], options));
}

function runRecoveryResolveTask(args, options = {}) {
  return parseCommandJson(runNode(['tools/recovery/resolve-task.mjs', ...args], options));
}

function createProjectInitWorkspace(baseDir, name) {
  const workspace = path.join(baseDir, name);
  fs.mkdirSync(workspace, { recursive: true });
  return workspace;
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function prepareApprovedFeature(baseDir, featureId, options = {}) {
  if (!options.projectPath) {
    options.projectPath = writeProjectWithWorkspace(baseDir, `${featureId}-project.json`, options.workspace ?? '.');
  }
  const paths = createFeature(baseDir, featureId, options);
  approvePrd(paths);
  createTaskPlan(paths);
  approveTaskPlan(paths);
  validateFeature(paths);
  return paths;
}

function testApprovalGate(baseDir) {
  const paths = createFeature(baseDir, 'approval-gate');
  const result = runNode([
    'tools/task-planner/create-task-plan.mjs',
    '--project', projectPath,
    '--prd', paths.prd,
    '--out', paths.taskPlan,
    '--run-state-out', paths.runState,
    '--force',
  ], { expectFailure: true });
  assert(result.stderr.includes('PRD 尚未人工确认'), '未确认 PRD 应阻止任务拆分');
}

function testHappyPath(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'happy-path');
  const result = runLoop(paths, ['--agent-adapter', 'mock']);
  assert(result.summary.status === 'complete', '完整执行后 summary.status 应为 complete');
  assert(result.summary.taskSummary.done.length === 3, '完整执行后 3 个 task 应全部 done');
  const runState = readJson(paths.runState);
  assert(runState.status === 'complete', '完整执行后 run-state.status 应为 complete');
  assert(typeof runState.startedAt === 'string' && runState.startedAt.length > 0, '完整执行后 run-state.startedAt 应记录开始时间');
  assert(runState.activeRunLock === null, '完整执行后 activeRunLock 应释放');
  assert(runState.artifacts.some((artifact) => artifact.type === 'taskContext'), 'Run Loop 应生成 taskContext 产物');
  const taskContext = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'task-context.json'));
  assert(taskContext.skill.id === 'ruoyi-module-crud', 'taskContext 应装配 requiredSkillId 对应的 skill');
  assert(taskContext.skill.document.includes('# Skill: ruoyi-module-crud'), 'taskContext 应包含 skill markdown 全文');
  validateFeature(paths);
}

function testUnknownAgentAdapter(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'unknown-agent-adapter');
  const result = runNode([
    'tools/run-loop/run-feature.mjs',
    '--project', projectPath,
    '--prd', paths.prd,
    '--task-plan', paths.taskPlan,
    '--run-state', paths.runState,
    '--agent-adapter', 'missing',
  ], { expectFailure: true });
  assert(result.stderr.includes('未知 Agent Adapter'), '未知 adapter 应被拒绝');
}

function testUnknownChecksMode(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'unknown-checks-mode');
  const result = runNode([
    'tools/run-loop/run-feature.mjs',
    '--project', projectPath,
    '--prd', paths.prd,
    '--task-plan', paths.taskPlan,
    '--run-state', paths.runState,
    '--checks-mode', 'missing',
  ], { expectFailure: true });
  assert(result.stderr.includes('--checks-mode 必须是 real、mock 或 command'), '未知 checks-mode 应被拒绝');
}

function testRunLoopRejectsUnknownArg(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'run-loop-unknown-arg');
  const result = runNode([
    'tools/run-loop/run-feature.mjs',
    '--project', projectPath,
    '--prd', paths.prd,
    '--task-plan', paths.taskPlan,
    '--run-state', paths.runState,
    '--shell-changed-files', 'src/unsafe.js',
  ], { expectFailure: true });
  assert(result.stderr.includes('未知参数：--shell-changed-files'), 'Run Loop 应拒绝已删除的 changedFiles 参数');
}

function testProjectInitCreatesProject(baseDir) {
  const workspace = createProjectInitWorkspace(baseDir, 'project-init-legal-workspace');
  const out = path.join(baseDir, 'project-init-legal.json');
  const result = runProjectInitCreateProject([
    '--project-id', 'project-init-legal',
    '--name', 'Project Init Legal',
    '--description', 'Project init e2e',
    '--base', `backend:backend-starter:https://example.com/backend.git:${workspace}`,
    '--out', out,
  ]);
  assert(result.ok === true, '合法 project 初始化应成功');
  const project = readJson(out);
  assert(project.projectId === 'project-init-legal', 'projectId 应写入输出');
  assert(project.bases[0].workspace === workspace, 'workspace 应写入输出');
  const report = validateFiles({
    project: out,
    prd: path.join(baseDir, 'missing-prd.json'),
    'task-plan': path.join(baseDir, 'missing-task-plan.json'),
    'run-state': path.join(baseDir, 'missing-run-state.json'),
    'templates-dir': templatesDir,
  });
  assert(!report.errors.some((item) => item.code === 'SCHEMA_INVALID' && item.file === out), 'project 输出应符合 schema');
}

function testProjectInitRejectsInvalidRepo(baseDir) {
  const workspace = createProjectInitWorkspace(baseDir, 'project-init-invalid-repo-workspace');
  const result = runNode([
    'tools/project-init/create-project.mjs',
    '--project-id', 'project-init-invalid-repo',
    '--name', 'Invalid Repo',
    '--base', `backend:backend-starter:not-a-uri:${workspace}`,
    '--out', path.join(baseDir, 'project-init-invalid-repo.json'),
  ], { expectFailure: true });
  assert(result.stderr.includes('repo 不是合法 URI'), '非法 repo URI 应失败');
}

function testProjectInitRejectsMissingTemplate(baseDir) {
  const workspace = createProjectInitWorkspace(baseDir, 'project-init-missing-template-workspace');
  const result = runNode([
    'tools/project-init/create-project.mjs',
    '--project-id', 'project-init-missing-template',
    '--name', 'Missing Template',
    '--base', `backend:missing-template:https://example.com/backend.git:${workspace}`,
    '--out', path.join(baseDir, 'project-init-missing-template.json'),
  ], { expectFailure: true });
  assert(result.stderr.includes('templateId 不存在'), 'templateId 不存在应失败');
}

function testProjectInitRejectsDuplicateBaseId(baseDir) {
  const workspace = createProjectInitWorkspace(baseDir, 'project-init-duplicate-base-workspace');
  const result = runNode([
    'tools/project-init/create-project.mjs',
    '--project-id', 'project-init-duplicate-base',
    '--name', 'Duplicate Base',
    '--base', `backend:backend-starter:https://example.com/backend.git:${workspace}`,
    '--base', `backend:middle-starter:https://example.com/middle.git:${workspace}`,
    '--out', path.join(baseDir, 'project-init-duplicate-base.json'),
  ], { expectFailure: true });
  assert(result.stderr.includes('baseId 不能重复'), 'baseId 重复应失败');
}

function testProjectInitRejectsMissingWorkspace(baseDir) {
  const result = runNode([
    'tools/project-init/create-project.mjs',
    '--project-id', 'project-init-missing-workspace',
    '--name', 'Missing Workspace',
    '--base', `backend:backend-starter:https://example.com/backend.git:${path.join(baseDir, 'missing-workspace')}`,
    '--out', path.join(baseDir, 'project-init-missing-workspace.json'),
  ], { expectFailure: true });
  assert(result.stderr.includes('workspace 不存在'), 'workspace 不存在应失败');
}

function testProjectInitRefusesAndForcesOverwrite(baseDir) {
  const workspace = createProjectInitWorkspace(baseDir, 'project-init-force-workspace');
  const out = path.join(baseDir, 'project-init-force.json');
  runProjectInitCreateProject([
    '--project-id', 'project-init-force',
    '--name', 'Before Force',
    '--base', `backend:backend-starter:https://example.com/backend.git:${workspace}`,
    '--out', out,
  ]);
  const refused = runNode([
    'tools/project-init/create-project.mjs',
    '--project-id', 'project-init-force',
    '--name', 'Refused Force',
    '--base', `backend:backend-starter:https://example.com/backend.git:${workspace}`,
    '--out', out,
  ], { expectFailure: true });
  assert(refused.stderr.includes('拒绝覆盖'), 'out 已存在时默认应拒绝覆盖');
  runProjectInitCreateProject([
    '--project-id', 'project-init-force',
    '--name', 'After Force',
    '--base', `backend:backend-starter:https://example.com/backend.git:${workspace}`,
    '--out', out,
    '--force',
  ]);
  assert(readJson(out).name === 'After Force', '--force 应覆盖已有 project 文件');
}

function testProjectInitCreateFeatureWithPrdApproval(baseDir) {
  const workspace = createProjectInitWorkspace(baseDir, 'project-init-feature-workspace');
  const projectOut = path.join(baseDir, 'project-init-feature-project.json');
  runProjectInitCreateProject([
    '--project-id', 'project-init-feature',
    '--name', 'Project Init Feature',
    '--base', `backend:backend-starter:https://example.com/backend.git:${workspace}`,
    '--out', projectOut,
  ]);
  const outDir = path.join(baseDir, 'project-init-feature-out');
  const result = runProjectInitCreateFeature([
    '--feature-id', 'project-init-feature',
    '--name', 'Project Init Feature',
    '--summary', '验证 feature 初始化',
    '--project', projectOut,
    '--bases', 'backend',
    '--out-dir', outDir,
    '--approve-prd-by', 'e2e',
  ]);
  assert(result.ok === true, 'feature 初始化应成功');
  assert(fs.existsSync(path.join(outDir, 'prd.json')), 'feature 初始化应生成 prd.json');
  assert(fs.existsSync(path.join(outDir, 'task-plan.json')), 'approve PRD 后应生成 task-plan.json');
  assert(fs.existsSync(path.join(outDir, 'run-state.json')), 'approve PRD 后应生成 run-state.json');
  assert(result.validationPassed === false, '未 approve task-plan 时 validator 应报告未完全通过但命令不失败');
}

function testProjectInitCreateFeatureDefaultDraftOnly(baseDir) {
  const workspace = createProjectInitWorkspace(baseDir, 'project-init-feature-draft-workspace');
  const projectOut = path.join(baseDir, 'project-init-feature-draft-project.json');
  runProjectInitCreateProject([
    '--project-id', 'project-init-feature-draft',
    '--name', 'Project Init Feature Draft',
    '--base', `backend:backend-starter:https://example.com/backend.git:${workspace}`,
    '--out', projectOut,
  ]);
  const outDir = path.join(baseDir, 'project-init-feature-draft-out');
  const result = runProjectInitCreateFeature([
    '--feature-id', 'project-init-feature-draft',
    '--name', 'Project Init Feature Draft',
    '--summary', '验证默认不确认',
    '--project', projectOut,
    '--bases', 'backend',
    '--out-dir', outDir,
  ]);
  assert(fs.existsSync(path.join(outDir, 'prd.json')), '默认应生成 draft prd.json');
  assert(!fs.existsSync(path.join(outDir, 'task-plan.json')), '默认不自动 approve 时不应生成 task-plan.json');
  assert(!fs.existsSync(path.join(outDir, 'run-state.json')), '默认不自动 approve 时不应生成 run-state.json');
  assert(result.taskPlanPath === null && result.runStatePath === null, '默认 draft-only 输出应明确标记 task-plan/run-state 为空');
}

function testProjectInitCreateFeatureRejectsTaskPlanApprovalWithoutPrdApproval(baseDir) {
  const workspace = createProjectInitWorkspace(baseDir, 'project-init-feature-task-plan-only-workspace');
  const projectOut = path.join(baseDir, 'project-init-feature-task-plan-only-project.json');
  runProjectInitCreateProject([
    '--project-id', 'project-init-feature-task-plan-only',
    '--name', 'Project Init Feature Task Plan Only',
    '--base', `backend:backend-starter:https://example.com/backend.git:${workspace}`,
    '--out', projectOut,
  ]);
  const result = runNode([
    'tools/project-init/create-feature.mjs',
    '--feature-id', 'project-init-feature-task-plan-only',
    '--name', 'Project Init Feature Task Plan Only',
    '--summary', '验证 task-plan 不能单独确认',
    '--project', projectOut,
    '--bases', 'backend',
    '--out-dir', path.join(baseDir, 'project-init-feature-task-plan-only-out'),
    '--approve-task-plan-by', 'e2e',
  ], { expectFailure: true });
  assert(result.stderr.includes('--approve-task-plan-by 需要同时提供 --approve-prd-by'), 'task-plan 确认必须显式依赖 PRD 确认');
}

function testProjectInitCreateFeatureApprovedValidates(baseDir) {
  const workspace = createProjectInitWorkspace(baseDir, 'project-init-feature-approved-workspace');
  const projectOut = path.join(baseDir, 'project-init-feature-approved-project.json');
  runProjectInitCreateProject([
    '--project-id', 'project-init-feature-approved',
    '--name', 'Project Init Feature Approved',
    '--base', `backend:backend-starter:https://example.com/backend.git:${workspace}`,
    '--out', projectOut,
  ]);
  const outDir = path.join(baseDir, 'project-init-feature-approved-out');
  const result = runProjectInitCreateFeature([
    '--feature-id', 'project-init-feature-approved',
    '--name', 'Project Init Feature Approved',
    '--summary', '验证 feature 显式确认',
    '--project', projectOut,
    '--bases', 'backend',
    '--out-dir', outDir,
    '--approve-prd-by', 'e2e',
    '--approve-task-plan-by', 'e2e',
  ]);
  assert(result.validationPassed === true, '显式 approve 后 validate-feature 应通过');
  const report = validateFiles({
    project: projectOut,
    prd: path.join(outDir, 'prd.json'),
    'task-plan': path.join(outDir, 'task-plan.json'),
    'run-state': path.join(outDir, 'run-state.json'),
    'templates-dir': templatesDir,
  });
  assert(report.valid, `显式 approve 后 validate-feature 应通过：${JSON.stringify(report, null, 2)}`);
}

function testMaxTasksPause(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'max-tasks-pause');
  const result = runLoop(paths, ['--max-tasks', '1']);
  assert(result.summary.status === 'has_exceptions', '只跑部分任务时 summary.status 应为 has_exceptions');
  assert(result.summary.taskSummary.done.length === 1, 'max-tasks=1 应只完成 1 个任务');
  const runState = readJson(paths.runState);
  assert(runState.status === 'paused', '仍有未完成任务且无异常时 run-state.status 应为 paused');
  assert(runState.activeRunLock === null, '暂停后 activeRunLock 应释放');
}

function testCheckFailureRetry(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'check-failure-retry');
  runLoop(paths, ['--mock-fail-task', 'TASK-001', '--mock-fail-stage', 'check']);
  const second = runLoop(paths, ['--mock-fail-task', 'TASK-001', '--mock-fail-stage', 'check']);
  assert(second.summary.taskSummary.checksFailed.includes('TASK-001'), '检查失败任务应进入 checksFailed');
  assert(second.summary.nextRunnableTaskIds.includes('TASK-001'), 'checks_failed 任务下一轮应可重跑');
  const taskRun = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'task-run.json'));
  assert(taskRun.attempts.length === 2, '失败复跑应保留 2 次 attempts');
  assert(taskRun.attempts.map((item) => item.attempt).join(',') === '1,2', 'attempt 编号应连续');
}

function testChecksRunnerFailure(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'checks-runner-failure');
  const result = runLoop(paths, ['--mock-fail-check', 'backend-compile']);
  assert(result.summary.taskSummary.checksFailed.includes('TASK-001'), 'Checks Runner 失败应让任务进入 checksFailed');
  const taskRun = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'task-run.json'));
  assert(taskRun.attempts[0].checks.some((check) => check.id === 'backend-compile' && check.status === 'failed'), '失败 check 应写入 task-run');
}

function testChecksRunnerRealCommand() {
  const result = runChecks({
    id: 'TASK-999',
    checks: [
      {
        id: 'real-command-pass',
        name: '真实命令通过',
        type: 'command',
        command: `${process.execPath} -e "process.exit(0)"`,
        required: true,
      },
      {
        id: 'real-command-fail',
        name: '真实命令失败',
        type: 'command',
        command: `${process.execPath} -e "process.exit(7)"`,
        required: true,
      },
    ],
  }, {
    mode: 'real',
    cwd: repoRoot,
    timeoutMs: 10000,
  });
  assert(result.status === 'checks_failed', '真实命令失败应让检查结果为 checks_failed');
  assert(result.checks.some((check) => check.id === 'real-command-pass' && check.status === 'passed'), '真实通过命令应记录 passed');
  assert(result.checks.some((check) => check.id === 'real-command-fail' && check.status === 'failed'), '真实失败命令应记录 failed');
}

function testChecksRunnerRealHttp() {
  const result = runChecks({
    id: 'TASK-998',
    checks: [
      {
        id: 'real-http-pass',
        name: '真实 HTTP 通过',
        type: 'http',
        required: true,
        http: {
          method: 'GET',
          url: 'data:text/plain,ok',
          expectedStatus: 200,
        },
      },
    ],
  }, {
    mode: 'real',
    cwd: repoRoot,
    timeoutMs: 10000,
  });
  assert(result.status === 'passed', '真实 HTTP 状态码匹配应通过');
  assert(result.checks.some((check) => check.id === 'real-http-pass' && check.status === 'passed'), '真实 HTTP 检查应记录 passed');
}

function reviewFixture({ allowedPaths, changedFiles, outcomeChangedFiles = [] }) {
  return runReview({
    runState: { runId: 'RUN-E2E' },
    reviewedAt: '2026-05-22T00:00:00.000Z',
    taskContext: {
      task: {
        id: 'TASK-001',
        title: 'Review fixture',
        allowedPaths,
        acceptanceCriteria: [{ id: 'AC-001', text: 'fixture passes' }],
      },
      executionHints: {
        allowedPaths,
        checks: [],
      },
    },
    outcome: {
      requestedStatus: 'done',
      reviewVerdict: 'pass',
      checks: [],
      changedFiles: outcomeChangedFiles,
    },
    taskRun: {
      attempts: [{ attempt: 1, changedFiles }],
    },
  });
}

function testReviewAllowedPathsPass() {
  const review = reviewFixture({
    allowedPaths: ['src/pages/notice/**', 'src/config.ts'],
    changedFiles: ['src/pages/notice/index.vue', 'src/config.ts'],
  });
  assert(review.verdict === 'pass', 'changedFiles 全部命中 allowedPaths 时 review 应通过');
  assert(review.scopeFindings.length === 0, 'allowedPaths 全部命中时不应有 scopeFindings');
}

function testReviewAllowedPathsFail() {
  const review = reviewFixture({
    allowedPaths: ['src/pages/notice/**'],
    changedFiles: ['src/pages/user/index.vue'],
  });
  assert(review.verdict === 'fail', 'changedFiles 越界时 review 应失败');
  assert(review.scopeFindings.length === 1, '单个越界文件应生成 1 条 scopeFinding');
  assert(review.scopeFindings[0].file === 'src/pages/user/index.vue', 'scopeFinding 应包含违规文件路径');
  assert(review.scopeFindings[0].description.includes('src/pages/notice/**'), 'scopeFinding 应包含允许范围');
}

function testReviewAllowedPathsGlobBoundary() {
  const review = reviewFixture({
    allowedPaths: ['src/pages/notice/**'],
    changedFiles: ['src/pages/noticeboard/index.vue'],
  });
  assert(review.verdict === 'fail', '/** 规则不应误匹配同名前缀目录');
  assert(review.scopeFindings[0].file === 'src/pages/noticeboard/index.vue', '/** 边界失败应记录违规文件');
}

function testReviewAllowedPathsPartialFail() {
  const review = reviewFixture({
    allowedPaths: ['src/pages/notice/**', 'src/config.ts'],
    changedFiles: ['src/pages/notice/index.vue', 'src/config.ts', 'src/pages/user/index.vue', 'README.md'],
  });
  assert(review.verdict === 'fail', '多文件部分越界时 review 应失败');
  assert(review.scopeFindings.map((finding) => finding.file).join(',') === 'src/pages/user/index.vue,README.md', 'scopeFindings 应精确列出越界文件');
}

function testReviewAllowedPathsEmptyChangedFiles() {
  const review = reviewFixture({
    allowedPaths: [],
    changedFiles: [],
    outcomeChangedFiles: ['unsafe/from-adapter.txt'],
  });
  assert(review.verdict === 'pass', 'changedFiles 为空时不应因 scope 审查失败');
  assert(review.scopeFindings.length === 0, 'changedFiles 为空时不应生成 scopeFindings');
}

function testShellAdapterSuccess(baseDir) {
  const localProjectPath = writeProjectWithWorkspace(baseDir, 'local-workspace-project.json', '.');
  const paths = prepareApprovedFeature(baseDir, 'shell-adapter-success', { projectPath: localProjectPath });
  const result = runLoop(paths, [
    '--agent-adapter', 'shell',
    '--shell-command', `${process.execPath} -e "console.log('shell-ok')"`,
  ]);
  assert(result.summary.taskSummary.done.includes('TASK-001'), 'shell adapter 成功时任务应 done');
  const taskRun = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'task-run.json'));
  assert(taskRun.attempts[0].agent.tool === 'shell', 'task-run 应记录 shell agent');
  assert(taskRun.attempts[0].summary.includes('shell-ok'), 'task-run 应记录 shell 输出摘要');
}

function writeFakeCodex(baseDir) {
  const fakePath = path.join(baseDir, 'fake-codex.mjs');
  fs.writeFileSync(fakePath, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--task-context')) {
  console.error('unexpected --task-context option');
  process.exit(12);
}
if (args[0] !== 'exec') {
  console.error('missing exec subcommand');
  process.exit(13);
}
function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : '';
}
const mode = valueAfter('--fake-mode') || 'success';
const prompt = args.at(-1) || '';
const match = prompt.match(/task-context 文件：(.+?)(?:\\n|$)/);
const taskContextPath = match ? match[1].trim() : '';
if (!taskContextPath || !fs.existsSync(taskContextPath)) {
  console.error('missing task context');
  process.exit(11);
}
if (mode === 'write-allowed') {
  fs.mkdirSync('src/pages/notice', { recursive: true });
  fs.writeFileSync('src/pages/notice/index.vue', 'after\\\\n');
}
if (mode === 'write-out-of-scope') {
  fs.mkdirSync('src/pages/user', { recursive: true });
  fs.writeFileSync('src/pages/user/index.vue', 'after\\\\n');
}
if (mode === 'fake-changed-files') {
  console.log(JSON.stringify({ changedFiles: ['unsafe/from-codex.txt'] }));
}
if (mode === 'fail') {
  console.error('fake codex failed');
  process.exit(7);
}
if (mode === 'timeout') {
  setTimeout(() => {}, 5000);
} else {
  console.log('fake codex ok');
}
`, 'utf8');
  fs.chmodSync(fakePath, 0o755);
  return fakePath;
}

function codexArgs(fakeCodex, mode, extraArgs = []) {
  return [
    '--agent-adapter', 'codex',
    '--codex-command', fakeCodex,
    '--codex-extra-arg', 'exec',
    '--codex-extra-arg', '--fake-mode',
    '--codex-extra-arg', mode,
    '--max-tasks', '1',
    ...extraArgs,
  ];
}

function codexExecArgs(fakeCodex, mode, extraArgs = []) {
  return [
    '--agent-adapter', 'codex',
    '--codex-command', fakeCodex,
    '--codex-extra-arg', 'exec',
    '--codex-extra-arg', '--fake-mode',
    '--codex-extra-arg', mode,
    '--max-tasks', '1',
    ...extraArgs,
  ];
}

function testAvailableAgentAdaptersIncludesCodex() {
  assert(availableAgentAdapters().includes('codex'), 'availableAgentAdapters 应包含 codex');
}

function testCodexAdapterSuccessNoChanges(baseDir) {
  const fakeCodex = writeFakeCodex(baseDir);
  const paths = prepareGitDiffFeature(baseDir, 'codex-success-no-changes');
  const result = runLoop(paths, codexArgs(fakeCodex, 'success'));
  assert(result.summary.taskSummary.done.includes('TASK-001'), 'codex fake 成功时任务应 done');
  const taskRun = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'task-run.json'));
  assert(taskRun.attempts[0].agent.tool === 'codex', 'task-run 应记录 codex agent');
  assert(taskRun.attempts[0].changedFiles.length === 0, 'codex 未改文件时 changedFiles 应为空');
}

function testCodexAdapterExecPromptShape(baseDir) {
  const fakeCodex = writeFakeCodex(baseDir);
  const paths = prepareGitDiffFeature(baseDir, 'codex-exec-prompt-shape');
  const result = runLoop(paths, codexExecArgs(fakeCodex, 'success'));
  assert(result.summary.taskSummary.done.includes('TASK-001'), 'codex exec prompt 形态应可执行');
  const taskRun = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'task-run.json'));
  assert(taskRun.attempts[0].summary.includes('fake codex ok'), 'codex fake 应收到 prompt 并执行成功');
}

function testCodexAdapterDefaultsToExec(baseDir) {
  const fakeCodex = writeFakeCodex(baseDir);
  const paths = prepareGitDiffFeature(baseDir, 'codex-default-exec');
  const result = runLoop(paths, [
    '--agent-adapter', 'codex',
    '--codex-command', fakeCodex,
    '--max-tasks', '1',
  ]);
  assert(result.summary.taskSummary.done.includes('TASK-001'), '未传 --codex-extra-arg 时应默认使用 exec 子命令');
}

function testCodexAdapterAllowedPathPass(baseDir) {
  const fakeCodex = writeFakeCodex(baseDir);
  const paths = prepareGitDiffFeature(baseDir, 'codex-allowed-path', { 'src/pages/notice/index.vue': 'before\n' });
  setFirstTaskAllowedPaths(paths, ['src/pages/notice/**']);
  const result = runLoop(paths, codexArgs(fakeCodex, 'write-allowed'));
  assert(result.summary.taskSummary.done.includes('TASK-001'), 'codex 修改允许路径时任务应 done');
  assert(firstAttemptChangedFiles(paths).join(',') === 'src/pages/notice/index.vue', 'codex 修改应由 git diff 写入 changedFiles');
  const review = firstReview(paths);
  assert(review.verdict === 'pass', 'codex 修改允许路径时 review 应 pass');
}

function testCodexAdapterOutOfScopeReviewFail(baseDir) {
  const fakeCodex = writeFakeCodex(baseDir);
  const paths = prepareGitDiffFeature(baseDir, 'codex-out-of-scope', { 'src/pages/user/index.vue': 'before\n' });
  setFirstTaskAllowedPaths(paths, ['src/pages/notice/**']);
  const result = runLoop(paths, codexArgs(fakeCodex, 'write-out-of-scope'));
  assert(result.summary.taskSummary.reviewFailed.includes('TASK-001'), 'codex 修改越界路径时任务应 review_failed');
  assert(firstAttemptChangedFiles(paths).join(',') === 'src/pages/user/index.vue', 'codex 越界修改也应由 git diff 采集');
  const review = firstReview(paths);
  assert(review.verdict === 'fail', 'codex 修改越界路径时 review 应 fail');
}

function testCodexAdapterIgnoresFakeChangedFiles(baseDir) {
  const fakeCodex = writeFakeCodex(baseDir);
  const paths = prepareGitDiffFeature(baseDir, 'codex-fake-changed-files');
  const result = runLoop(paths, codexArgs(fakeCodex, 'fake-changed-files'));
  assert(result.summary.taskSummary.done.includes('TASK-001'), 'codex 仅输出伪造 changedFiles 时任务仍可 done');
  assert(firstAttemptChangedFiles(paths).length === 0, 'codex 输出的伪造 changedFiles 不应被采用');
}

function testCodexAdapterNonZeroNeedsHuman(baseDir) {
  const fakeCodex = writeFakeCodex(baseDir);
  const paths = prepareGitDiffFeature(baseDir, 'codex-non-zero');
  const result = runLoop(paths, codexArgs(fakeCodex, 'fail'));
  assert(result.summary.taskSummary.needsHuman.includes('TASK-001'), 'codex 非 0 退出应进入 needsHuman');
  const taskRun = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'task-run.json'));
  assert(taskRun.attempts[0].errors.some((item) => item.includes('exited with status 7')), 'codex 非 0 应记录退出码');
}

function testCodexAdapterMissingCommandNeedsHuman(baseDir) {
  const paths = prepareGitDiffFeature(baseDir, 'codex-missing-command');
  const result = runLoop(paths, [
    '--agent-adapter', 'codex',
    '--codex-command', path.join(baseDir, 'missing-codex-command'),
    '--max-tasks', '1',
  ]);
  assert(result.summary.taskSummary.needsHuman.includes('TASK-001'), 'codex 命令不存在应进入 needsHuman');
  const taskRun = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'task-run.json'));
  assert(taskRun.attempts[0].errors.some((item) => item.includes('failed to start')), 'codex 命令不存在应记录启动失败');
}

function testCodexAdapterTimeoutNeedsHuman(baseDir) {
  const fakeCodex = writeFakeCodex(baseDir);
  const paths = prepareGitDiffFeature(baseDir, 'codex-timeout');
  const result = runLoop(paths, codexArgs(fakeCodex, 'timeout', ['--codex-timeout-ms', '1000']));
  assert(result.summary.taskSummary.needsHuman.includes('TASK-001'), 'codex timeout 应进入 needsHuman');
  const taskRun = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'task-run.json'));
  assert(taskRun.attempts[0].errors.some((item) => item.includes('timeout')), 'codex timeout 应记录错误');
}

function testCodexAdapterInvalidTimeoutNeedsHuman(baseDir) {
  const fakeCodex = writeFakeCodex(baseDir);
  const paths = prepareGitDiffFeature(baseDir, 'codex-invalid-timeout');
  const result = runLoop(paths, codexArgs(fakeCodex, 'success', ['--codex-timeout-ms', '999']));
  assert(result.summary.taskSummary.needsHuman.includes('TASK-001'), '非法 --codex-timeout-ms 应进入 needsHuman');
  const taskRun = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'task-run.json'));
  assert(taskRun.attempts[0].errors.includes('非法 --codex-timeout-ms'), '非法 timeout 应记录明确错误');
}

function prepareGitDiffFeature(baseDir, featureId, files = {}) {
  const workspace = path.join(baseDir, featureId, 'workspace');
  initGitWorkspace(workspace, files);
  const localProjectPath = writeProjectWithWorkspace(baseDir, `${featureId}-project.json`, workspace);
  return prepareApprovedFeature(baseDir, featureId, { projectPath: localProjectPath, bases: 'backend' });
}

function setFirstTaskAllowedPaths(paths, allowedPaths) {
  const taskPlan = readJson(paths.taskPlan);
  taskPlan.storyGroups[0].tasks[0].allowedPaths = allowedPaths;
  fs.writeFileSync(paths.taskPlan, `${JSON.stringify(taskPlan, null, 2)}\n`, 'utf8');
}

function firstAttemptChangedFiles(paths) {
  const taskRun = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'task-run.json'));
  return taskRun.attempts[0].changedFiles;
}

function firstReview(paths) {
  return readJson(path.join(paths.dir, 'runs', 'TASK-001', 'review.json'));
}

function testGitDiffCollectsModifiedFile(baseDir) {
  const paths = prepareGitDiffFeature(baseDir, 'git-diff-modified', { 'src/app.txt': 'before\n' });
  runLoop(paths, [
    '--agent-adapter', 'shell',
    '--shell-command', `${process.execPath} -e "require('fs').writeFileSync('src/app.txt','after\\n')"`,
    '--max-tasks', '1',
  ]);
  assert(firstAttemptChangedFiles(paths).includes('src/app.txt'), '修改文件应写入 changedFiles 相对路径');
}

function testGitDiffCollectsAddedFile(baseDir) {
  const paths = prepareGitDiffFeature(baseDir, 'git-diff-added');
  runLoop(paths, [
    '--agent-adapter', 'shell',
    '--shell-command', `${process.execPath} -e "require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/new.txt','new\\n')"`,
    '--max-tasks', '1',
  ]);
  assert(firstAttemptChangedFiles(paths).includes('src/new.txt'), '新增文件应写入 changedFiles 相对路径');
}

function testGitDiffCollectsMultipleFiles(baseDir) {
  const paths = prepareGitDiffFeature(baseDir, 'git-diff-multiple', {
    'src/a.txt': 'before-a\n',
    'src/delete-me.txt': 'delete\n',
  });
  runLoop(paths, [
    '--agent-adapter', 'shell',
    '--shell-command', `${process.execPath} -e "const fs=require('fs');fs.writeFileSync('src/a.txt','after-a\\n');fs.writeFileSync('src/b.txt','new-b\\n');fs.unlinkSync('src/delete-me.txt')"`,
    '--max-tasks', '1',
  ]);
  assert(firstAttemptChangedFiles(paths).join(',') === 'src/a.txt,src/b.txt,src/delete-me.txt', '同一 attempt 的多文件变更应按相对路径排序写入 changedFiles');
}

function testGitDiffCollectsDeletedFile(baseDir) {
  const paths = prepareGitDiffFeature(baseDir, 'git-diff-deleted', { 'src/delete-me.txt': 'delete\n' });
  runLoop(paths, [
    '--agent-adapter', 'shell',
    '--shell-command', `${process.execPath} -e "require('fs').unlinkSync('src/delete-me.txt')"`,
    '--max-tasks', '1',
  ]);
  assert(firstAttemptChangedFiles(paths).includes('src/delete-me.txt'), '删除文件应写入 changedFiles 相对路径');
}

function testGitDiffIgnoresRestoredFile(baseDir) {
  const paths = prepareGitDiffFeature(baseDir, 'git-diff-restored', { 'src/restored.txt': 'original\n' });
  runLoop(paths, [
    '--agent-adapter', 'shell',
    '--shell-command', `${process.execPath} -e "require('fs').writeFileSync('src/restored.txt','temporary\\n');require('fs').writeFileSync('src/restored.txt','original\\n')"`,
    '--max-tasks', '1',
  ]);
  assert(!firstAttemptChangedFiles(paths).includes('src/restored.txt'), '恢复原内容的文件不应写入 changedFiles');
}

function testGitDiffRequiresGitWorkspace(baseDir) {
  const workspace = path.join(baseDir, 'non-git-workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const localProjectPath = writeProjectWithWorkspace(baseDir, 'non-git-workspace-project.json', workspace);
  const paths = prepareApprovedFeature(baseDir, 'non-git-workspace', { projectPath: localProjectPath, bases: 'backend' });
  const result = runLoop(paths, [
    '--agent-adapter', 'shell',
    '--shell-command', `${process.execPath} -e "console.log('should-not-run')"`,
    '--max-tasks', '1',
  ]);
  assert(result.summary.taskSummary.needsHuman.includes('TASK-001'), '非 git workspace 应进入 needsHuman');
  const runState = readJson(paths.runState);
  assert(runState.taskStates['TASK-001'].lastIssue.summary.includes('不是 git 仓库'), '非 git workspace 应记录明确失败原因');
}

function testRunLoopAllowedPathShellPass(baseDir) {
  const paths = prepareGitDiffFeature(baseDir, 'run-loop-allowed-path-pass', { 'src/pages/notice/index.vue': 'before\n' });
  setFirstTaskAllowedPaths(paths, ['src/pages/notice/**']);
  const result = runLoop(paths, [
    '--agent-adapter', 'shell',
    '--shell-command', `${process.execPath} -e "require('fs').writeFileSync('src/pages/notice/index.vue','after\\n')"`,
    '--max-tasks', '1',
  ]);
  assert(result.summary.taskSummary.done.includes('TASK-001'), 'shell 修改允许路径时任务应 done');
  const review = firstReview(paths);
  assert(review.verdict === 'pass', 'shell 修改允许路径时 review 应 pass');
  assert(review.scopeFindings.length === 0, 'shell 修改允许路径时不应有 scopeFindings');
}

function testRunLoopOutOfScopeShellFail(baseDir) {
  const paths = prepareGitDiffFeature(baseDir, 'run-loop-out-of-scope-fail', { 'src/pages/user/index.vue': 'before\n' });
  setFirstTaskAllowedPaths(paths, ['src/pages/notice/**']);
  const result = runLoop(paths, [
    '--agent-adapter', 'shell',
    '--shell-command', `${process.execPath} -e "require('fs').writeFileSync('src/pages/user/index.vue','after\\n')"`,
    '--max-tasks', '1',
  ]);
  assert(result.summary.taskSummary.reviewFailed.includes('TASK-001'), 'shell 修改越界路径时任务应 review_failed');
  const review = firstReview(paths);
  assert(review.verdict === 'fail', 'shell 修改越界路径时 review 应 fail');
  assert(review.scopeFindings.map((finding) => finding.file).join(',') === 'src/pages/user/index.vue', 'shell 越界 review 应精确列出违规文件');
}

function testRealChecksUseBaseWorkspace(baseDir) {
  const workspace = path.join(baseDir, 'real-check-workspace');
  initGitWorkspace(workspace, { 'base-marker.txt': 'ok\n' });
  const localProjectPath = writeProjectWithWorkspace(baseDir, 'real-check-workspace-project.json', workspace);
  const paths = prepareApprovedFeature(baseDir, 'real-check-workspace', { projectPath: localProjectPath, bases: 'backend' });
  const taskPlan = readJson(paths.taskPlan);
  const firstTask = taskPlan.storyGroups[0].tasks[0];
  firstTask.checks = [
    {
      id: 'base-workspace-marker',
      name: '基座工作目录检查',
      type: 'command',
      command: 'test -f base-marker.txt',
      required: true,
      baseId: firstTask.targetBaseId,
    },
  ];
  fs.writeFileSync(paths.taskPlan, `${JSON.stringify(taskPlan, null, 2)}\n`, 'utf8');
  const result = runLoop(paths, [
    '--agent-adapter', 'shell',
    '--checks-mode', 'real',
    '--shell-command', `${process.execPath} -e "console.log('workspace-ok')"`,
    '--max-tasks', '1',
  ]);
  assert(result.summary.taskSummary.done.includes(firstTask.id), '真实 checks 应在 base workspace 中执行并通过');
  const taskRun = readJson(path.join(paths.dir, 'runs', firstTask.id, 'task-run.json'));
  assert(taskRun.attempts[0].checks.some((check) => check.id === 'base-workspace-marker' && check.status === 'passed'), 'task-run 应记录 base workspace check passed');
}

function testShellAdapterMissingCommand(baseDir) {
  const localProjectPath = writeProjectWithWorkspace(baseDir, 'local-workspace-project-missing-command.json', '.');
  const paths = prepareApprovedFeature(baseDir, 'shell-adapter-missing-command', { projectPath: localProjectPath });
  const result = runLoop(paths, ['--agent-adapter', 'shell']);
  assert(result.summary.taskSummary.needsHuman.includes('TASK-001'), 'shell adapter 缺少命令时任务应 needsHuman');
  const taskRun = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'task-run.json'));
  assert(taskRun.attempts[0].errors.includes('缺少 --shell-command'), 'task-run 应记录缺少命令错误');
}

function testReviewFailureRetry(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'review-failure-retry');
  const result = runLoop(paths, ['--mock-fail-task', 'TASK-001', '--mock-fail-stage', 'review']);
  assert(result.summary.taskSummary.reviewFailed.includes('TASK-001'), '评审失败任务应进入 reviewFailed');
  assert(result.summary.nextRunnableTaskIds.includes('TASK-001'), 'review_failed 任务下一轮应可重跑');
  const review = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'review.json'));
  assert(review.verdict === 'fail', '评审失败应生成 fail review 产物');
}

function testNeedsHuman(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'needs-human');
  const result = runLoop(paths, ['--mock-fail-task', 'TASK-001', '--mock-fail-stage', 'human']);
  assert(result.summary.taskSummary.needsHuman.includes('TASK-001'), '人工处理任务应进入 needsHuman');
  assert(!result.summary.nextRunnableTaskIds.includes('TASK-001'), 'needs_human 任务不应自动重跑');
  const runState = readJson(paths.runState);
  assert(runState.status === 'failed', '存在 needs_human 时 run-state.status 应为 failed');
  assert(runState.activeRunLock === null, '异常后 activeRunLock 应释放');
}

function issueFixture(summary, source = 'orchestrator') {
  return {
    type: 'e2e_issue',
    summary,
    source,
    requiredDecision: '',
    createdAt: '2026-05-22T00:00:00.000Z',
  };
}

function setTaskStatus(paths, taskId, status, lastIssue = null) {
  const runState = readJson(paths.runState);
  runState.taskStates[taskId].status = status;
  runState.taskStates[taskId].lastIssue = lastIssue;
  runState.taskStates[taskId].updatedAt = '2026-05-22T00:00:00.000Z';
  writeJsonFile(paths.runState, runState);
  return runState;
}

function resolveArgs(paths, taskId, action = 'retry') {
  return [
    '--run-state', paths.runState,
    '--task-id', taskId,
    '--action', action,
    '--by', 'e2e',
    '--reason', `${action} for e2e`,
  ];
}

function testRecoveryListIssues(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'recovery-list-issues');
  const runState = readJson(paths.runState);
  runState.taskStates['TASK-001'].status = 'checks_failed';
  runState.taskStates['TASK-001'].lastIssue = issueFixture('check failed', 'check');
  runState.taskStates['TASK-002'].status = 'review_failed';
  runState.taskStates['TASK-002'].lastIssue = issueFixture('review failed', 'reviewer');
  runState.taskStates['TASK-003'].status = 'needs_human';
  runState.taskStates['TASK-003'].lastIssue = issueFixture('needs human');
  writeJsonFile(paths.runState, runState);

  const result = runRecoveryListIssues(['--run-state', paths.runState]);
  assert(result.issues.map((item) => item.taskId).join(',') === 'TASK-001,TASK-002,TASK-003', 'list-issues 应只列异常任务');
  assert(result.issues.every((item) => ['checks_failed', 'review_failed', 'needs_human'].includes(item.status)), 'list-issues 不应列 ready/done/cancelled');
}

function testRecoveryListIssuesEmpty(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'recovery-list-empty');
  const result = runRecoveryListIssues(['--run-state', paths.runState]);
  assert(Array.isArray(result.issues) && result.issues.length === 0, '无异常时 list-issues 应返回空数组');
}

function testRecoveryShowTaskWithReview(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'recovery-show-with-review');
  runLoop(paths, ['--mock-fail-task', 'TASK-001', '--mock-fail-stage', 'review']);
  const result = runRecoveryShowTask([
    '--feature-dir', paths.dir,
    '--run-state', paths.runState,
    '--task-id', 'TASK-001',
  ]);
  assert(result.state.status === 'review_failed', 'show-task 应输出 task state');
  assert(result.taskRun.attempts.length === 1, 'show-task 应输出 task-run attempts 摘要');
  assert(result.review.verdict === 'fail', 'show-task 应输出 review 摘要');
}

function testRecoveryShowTaskWithoutReview(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'recovery-show-without-review');
  runLoop(paths, ['--mock-fail-check', 'backend-compile']);
  const result = runRecoveryShowTask([
    '--feature-dir', paths.dir,
    '--run-state', paths.runState,
    '--task-id', 'TASK-001',
  ]);
  assert(result.state.status === 'checks_failed', 'show-task 应输出 check 失败状态');
  assert(result.taskRun.attempts.length === 1, 'show-task 无 review 时也应输出 attempts');
  assert(result.review === null, 'review 不存在时应返回 null');
}

function assertRecoveryRetry(baseDir, featureId, status) {
  const paths = prepareApprovedFeature(baseDir, featureId);
  setTaskStatus(paths, 'TASK-001', status, issueFixture(`${status} issue`));
  const result = runRecoveryResolveTask(resolveArgs(paths, 'TASK-001', 'retry'));
  const runState = readJson(paths.runState);
  assert(result.fromStatus === status && result.toStatus === 'ready', `${status} retry 应返回 ready`);
  assert(runState.taskStates['TASK-001'].status === 'ready', `${status} retry 应写回 ready`);
  assert(runState.taskStates['TASK-001'].lastIssue === null, `${status} retry 应清空 lastIssue`);
  assert(runState.decisions.at(-1).taskId === 'TASK-001', `${status} retry 应记录 taskId`);
  assert(runState.decisions.at(-1).action === 'retry', `${status} retry 应记录 action`);
  assert(runState.decisions.at(-1).fromStatus === status && runState.decisions.at(-1).toStatus === 'ready', `${status} retry 应记录状态迁移`);
}

function testRecoveryRetryChecksFailed(baseDir) {
  assertRecoveryRetry(baseDir, 'recovery-retry-checks-failed', 'checks_failed');
}

function testRecoveryRetryReviewFailed(baseDir) {
  assertRecoveryRetry(baseDir, 'recovery-retry-review-failed', 'review_failed');
}

function testRecoveryRetryNeedsHuman(baseDir) {
  assertRecoveryRetry(baseDir, 'recovery-retry-needs-human', 'needs_human');
}

function testRecoveryCancelNeedsHuman(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'recovery-cancel-needs-human');
  setTaskStatus(paths, 'TASK-001', 'needs_human', issueFixture('needs human'));
  const result = runRecoveryResolveTask(resolveArgs(paths, 'TASK-001', 'cancel'));
  const runState = readJson(paths.runState);
  assert(result.toStatus === 'cancelled', 'needs_human cancel 应转 cancelled');
  assert(runState.taskStates['TASK-001'].status === 'cancelled', 'cancel 应写回 cancelled');
  assert(runState.taskStates['TASK-001'].lastIssue.summary === 'needs human', 'cancel 不应清空 lastIssue');
  assert(runState.decisions.at(-1).action === 'cancel', 'cancel 应记录人工决策');
}

function assertResolveFailsUnchanged(paths, args, expectedMessage) {
  const before = fs.readFileSync(paths.runState, 'utf8');
  const result = runNode(['tools/recovery/resolve-task.mjs', ...args], { expectFailure: true });
  const after = fs.readFileSync(paths.runState, 'utf8');
  assert(result.stderr.includes(expectedMessage), `失败输出应包含：${expectedMessage}`);
  assert(after === before, 'resolve-task 失败时不应修改 run-state');
}

function testRecoveryRejectsRetryForStableStatuses(baseDir) {
  for (const status of ['ready', 'running', 'done', 'cancelled']) {
    const paths = prepareApprovedFeature(baseDir, `recovery-reject-${status}`);
    setTaskStatus(paths, 'TASK-001', status, status === 'ready' ? null : issueFixture(`${status} issue`));
    assertResolveFailsUnchanged(paths, resolveArgs(paths, 'TASK-001', 'retry'), `状态 ${status} 不允许 retry`);
  }
}

function testRecoveryRejectsCancelForNonNeedsHuman(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'recovery-reject-cancel-review-failed');
  setTaskStatus(paths, 'TASK-001', 'review_failed', issueFixture('review failed'));
  assertResolveFailsUnchanged(paths, resolveArgs(paths, 'TASK-001', 'cancel'), 'cancel 仅允许 needs_human');
}

function testRecoveryRejectsMissingByReason(baseDir) {
  const missingBy = prepareApprovedFeature(baseDir, 'recovery-reject-missing-by');
  setTaskStatus(missingBy, 'TASK-001', 'needs_human', issueFixture('needs human'));
  assertResolveFailsUnchanged(missingBy, [
    '--run-state', missingBy.runState,
    '--task-id', 'TASK-001',
    '--action', 'retry',
    '--reason', 'missing by',
  ], '缺少必填参数 --by');

  const missingReason = prepareApprovedFeature(baseDir, 'recovery-reject-missing-reason');
  setTaskStatus(missingReason, 'TASK-001', 'needs_human', issueFixture('needs human'));
  assertResolveFailsUnchanged(missingReason, [
    '--run-state', missingReason.runState,
    '--task-id', 'TASK-001',
    '--action', 'retry',
    '--by', 'e2e',
  ], '缺少必填参数 --reason');
}

function testRecoveryRejectsMissingTaskAndInvalidAction(baseDir) {
  const missingTask = prepareApprovedFeature(baseDir, 'recovery-reject-missing-task');
  assertResolveFailsUnchanged(missingTask, resolveArgs(missingTask, 'TASK-999', 'retry'), 'task 不存在');

  const invalidAction = prepareApprovedFeature(baseDir, 'recovery-reject-invalid-action');
  setTaskStatus(invalidAction, 'TASK-001', 'needs_human', issueFixture('needs human'));
  assertResolveFailsUnchanged(invalidAction, [
    '--run-state', invalidAction.runState,
    '--task-id', 'TASK-001',
    '--action', 'missing',
    '--by', 'e2e',
    '--reason', 'invalid action',
  ], '非法 action');
}

function testRecoveryRetryLetsRunLoopContinue(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'recovery-run-loop-continues');
  runLoop(paths, ['--mock-fail-check', 'backend-compile', '--max-tasks', '1']);
  runRecoveryResolveTask(resolveArgs(paths, 'TASK-001', 'retry'));
  const result = runLoop(paths, ['--max-tasks', '1']);
  const runState = readJson(paths.runState);
  assert(result.summary.taskSummary.done.includes('TASK-001'), 'retry 后 Run Loop 应继续执行恢复任务');
  assert(runState.taskStates['TASK-001'].status === 'done', '恢复任务执行后应 done');
}

function testRecoveryCancelPreventsRunLoopExecution(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'recovery-cancel-prevents-run');
  runLoop(paths, ['--mock-fail-task', 'TASK-001', '--mock-fail-stage', 'human', '--max-tasks', '1']);
  const beforeAttempts = readJson(paths.runState).taskStates['TASK-001'].attempts;
  runRecoveryResolveTask(resolveArgs(paths, 'TASK-001', 'cancel'));
  runLoop(paths, ['--max-tasks', '1']);
  const runState = readJson(paths.runState);
  assert(runState.taskStates['TASK-001'].status === 'cancelled', 'cancel 后 Run Loop 不应执行该任务');
  assert(runState.taskStates['TASK-001'].attempts === beforeAttempts, 'cancel 后 attempts 不应增加');
}

const tests = [
  ['JSON 契约文件可解析', (_baseDir) => validateJsonFixtures()],
  ['PRD 人工确认门禁', testApprovalGate],
  ['未知 Agent Adapter 拒绝', testUnknownAgentAdapter],
  ['未知 Checks Mode 拒绝', testUnknownChecksMode],
  ['Run Loop 未知参数拒绝', testRunLoopRejectsUnknownArg],
  ['Project Init 合法 project 初始化', testProjectInitCreatesProject],
  ['Project Init 非法 repo URI 失败', testProjectInitRejectsInvalidRepo],
  ['Project Init templateId 不存在失败', testProjectInitRejectsMissingTemplate],
  ['Project Init baseId 重复失败', testProjectInitRejectsDuplicateBaseId],
  ['Project Init workspace 不存在失败', testProjectInitRejectsMissingWorkspace],
  ['Project Init out 已存在拒绝和 force 覆盖', testProjectInitRefusesAndForcesOverwrite],
  ['Project Init feature 默认只生成 draft PRD', testProjectInitCreateFeatureDefaultDraftOnly],
  ['Project Init feature 拒绝单独确认 task-plan', testProjectInitCreateFeatureRejectsTaskPlanApprovalWithoutPrdApproval],
  ['Project Init feature 生成 prd/task-plan/run-state', testProjectInitCreateFeatureWithPrdApproval],
  ['Project Init feature 显式 approve 后校验通过', testProjectInitCreateFeatureApprovedValidates],
  ['完整主流程', testHappyPath],
  ['max-tasks 暂停流程', testMaxTasksPause],
  ['检查失败复跑 attempts', testCheckFailureRetry],
  ['Checks Runner 定点失败', testChecksRunnerFailure],
  ['Checks Runner 真实命令', testChecksRunnerRealCommand],
  ['Checks Runner 真实 HTTP', testChecksRunnerRealHttp],
  ['Review Runner allowedPaths 全命中', testReviewAllowedPathsPass],
  ['Review Runner allowedPaths 越界失败', testReviewAllowedPathsFail],
  ['Review Runner allowedPaths 目录边界', testReviewAllowedPathsGlobBoundary],
  ['Review Runner allowedPaths 部分越界', testReviewAllowedPathsPartialFail],
  ['Review Runner changedFiles 为空不失败', testReviewAllowedPathsEmptyChangedFiles],
  ['Agent Adapter 列表包含 codex', testAvailableAgentAdaptersIncludesCodex],
  ['Shell Adapter 成功执行', testShellAdapterSuccess],
  ['Codex Adapter fake 成功不改文件', testCodexAdapterSuccessNoChanges],
  ['Codex Adapter exec prompt 形态', testCodexAdapterExecPromptShape],
  ['Codex Adapter 默认 exec 子命令', testCodexAdapterDefaultsToExec],
  ['Codex Adapter fake 修改允许路径', testCodexAdapterAllowedPathPass],
  ['Codex Adapter fake 修改越界路径', testCodexAdapterOutOfScopeReviewFail],
  ['Codex Adapter 忽略伪造 changedFiles', testCodexAdapterIgnoresFakeChangedFiles],
  ['Codex Adapter 非 0 退出', testCodexAdapterNonZeroNeedsHuman],
  ['Codex Adapter 命令不存在', testCodexAdapterMissingCommandNeedsHuman],
  ['Codex Adapter timeout', testCodexAdapterTimeoutNeedsHuman],
  ['Codex Adapter 非法 timeout', testCodexAdapterInvalidTimeoutNeedsHuman],
  ['Git Diff Collector 采集修改文件', testGitDiffCollectsModifiedFile],
  ['Git Diff Collector 采集新增文件', testGitDiffCollectsAddedFile],
  ['Git Diff Collector 采集多文件', testGitDiffCollectsMultipleFiles],
  ['Git Diff Collector 采集删除文件', testGitDiffCollectsDeletedFile],
  ['Git Diff Collector 忽略恢复文件', testGitDiffIgnoresRestoredFile],
  ['Git Diff Collector 要求 git workspace', testGitDiffRequiresGitWorkspace],
  ['Run Loop shell 修改允许路径通过', testRunLoopAllowedPathShellPass],
  ['Run Loop shell 修改越界路径失败', testRunLoopOutOfScopeShellFail],
  ['Run Loop 真实检查使用基座目录', testRealChecksUseBaseWorkspace],
  ['Shell Adapter 缺少命令', testShellAdapterMissingCommand],
  ['评审失败复跑入口', testReviewFailureRetry],
  ['needs_human 非阻塞状态', testNeedsHuman],
  ['Recovery list-issues 正常', testRecoveryListIssues],
  ['Recovery list-issues 空列表', testRecoveryListIssuesEmpty],
  ['Recovery show-task 有 review', testRecoveryShowTaskWithReview],
  ['Recovery show-task 无 review', testRecoveryShowTaskWithoutReview],
  ['Recovery checks_failed retry', testRecoveryRetryChecksFailed],
  ['Recovery review_failed retry', testRecoveryRetryReviewFailed],
  ['Recovery needs_human retry', testRecoveryRetryNeedsHuman],
  ['Recovery needs_human cancel', testRecoveryCancelNeedsHuman],
  ['Recovery 稳定状态拒绝 retry', testRecoveryRejectsRetryForStableStatuses],
  ['Recovery 非 needs_human 拒绝 cancel', testRecoveryRejectsCancelForNonNeedsHuman],
  ['Recovery 缺 by/reason 拒绝且不改文件', testRecoveryRejectsMissingByReason],
  ['Recovery task 不存在和非法 action 拒绝', testRecoveryRejectsMissingTaskAndInvalidAction],
  ['Recovery retry 后 Run Loop 继续执行', testRecoveryRetryLetsRunLoopContinue],
  ['Recovery cancel 后 Run Loop 不执行', testRecoveryCancelPreventsRunLoopExecution],
];

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-e2e-'));
  const failures = [];
  console.log(`E2E 临时目录：${baseDir}`);

  try {
    for (const [name, fn] of tests) {
      try {
        const details = fn(baseDir);
        writeResult(true, name, details);
      } catch (error) {
        failures.push({ name, error });
        writeResult(false, name, error.message);
      }
    }
  } finally {
    if (args.keepTmp) {
      console.log(`已保留临时目录：${baseDir}`);
    } else {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  }

  if (failures.length > 0) {
    console.error(`E2E 失败：${failures.length}/${tests.length}`);
    process.exit(1);
  }
  console.log(`E2E 通过：${tests.length}/${tests.length}`);
}

main();
