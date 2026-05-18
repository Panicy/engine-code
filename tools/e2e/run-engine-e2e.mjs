#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateFiles } from '../validator/validate-feature.mjs';

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

function createFeature(baseDir, featureId, options = {}) {
  const paths = featurePaths(baseDir, featureId);
  fs.mkdirSync(paths.dir, { recursive: true });
  parseCommandJson(runNode([
    'tools/prd-builder/create-prd.mjs',
    '--feature-id', featureId,
    '--name', options.name ?? `E2E-${featureId}`,
    '--summary', options.summary ?? `验证 ${featureId} 流程`,
    '--project', projectPath,
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
    '--project', projectPath,
    '--prd', paths.prd,
    '--out', paths.taskPlan,
    '--run-state-out', paths.runState,
    '--force',
  ]));
}

function approveTaskPlan(paths) {
  parseCommandJson(runNode([
    'tools/task-planner/approve-task-plan.mjs',
    '--project', projectPath,
    '--prd', paths.prd,
    '--task-plan', paths.taskPlan,
    '--run-state', paths.runState,
    '--by', 'e2e',
  ]));
}

function runLoop(paths, extraArgs = []) {
  return parseCommandJson(runNode([
    'tools/run-loop/run-feature.mjs',
    '--project', projectPath,
    '--prd', paths.prd,
    '--task-plan', paths.taskPlan,
    '--run-state', paths.runState,
    ...extraArgs,
  ]));
}

function validateFeature(paths) {
  const report = validateFiles({
    project: projectPath,
    prd: paths.prd,
    'task-plan': paths.taskPlan,
    'run-state': paths.runState,
    'templates-dir': templatesDir,
  });
  assert(report.valid, `Validator 校验失败：${JSON.stringify(report, null, 2)}`);
  return report;
}

function prepareApprovedFeature(baseDir, featureId, options = {}) {
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
  assert(runState.activeRunLock === null, '完整执行后 activeRunLock 应释放');
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
  assert(result.stderr.includes('--checks-mode 必须是 mock 或 command'), '未知 checks-mode 应被拒绝');
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

const tests = [
  ['JSON 契约文件可解析', (_baseDir) => validateJsonFixtures()],
  ['PRD 人工确认门禁', testApprovalGate],
  ['未知 Agent Adapter 拒绝', testUnknownAgentAdapter],
  ['未知 Checks Mode 拒绝', testUnknownChecksMode],
  ['完整主流程', testHappyPath],
  ['max-tasks 暂停流程', testMaxTasksPause],
  ['检查失败复跑 attempts', testCheckFailureRetry],
  ['Checks Runner 定点失败', testChecksRunnerFailure],
  ['评审失败复跑入口', testReviewFailureRetry],
  ['needs_human 非阻塞状态', testNeedsHuman],
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
