#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const sourceTemplate = path.resolve(repoRoot, '.engine/source-templates/uniapp-template');
let lastBaseDir = null;

function usage() {
  return [
    '用法：node tools/e2e/run-real-demand-e2e.mjs',
    '',
    '可选：',
    '  --scenario client-announcement-tags|client-review-violation',
    '  --adapter shell|codex',
    '  --codex-command codex',
    '  --keep-tmp',
    '',
    '默认使用 shell adapter，在 /private/tmp 复制 uniapp-template 后运行真实 npm test。',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { scenario: 'client-announcement-tags', adapter: 'shell' };
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
    if (!['scenario', 'adapter', 'codex-command'].includes(key)) {
      throw new Error(`未知参数：${arg}`);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${arg} 缺少值`);
    args[key] = value;
    i += 1;
  }
  if (!['client-announcement-tags', 'client-review-violation'].includes(args.scenario)) {
    throw new Error(`未知 scenario：${args.scenario}`);
  }
  if (!['shell', 'codex'].includes(args.adapter)) {
    throw new Error(`未知 adapter：${args.adapter}`);
  }
  return args;
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

function copySourceTemplate(workspace) {
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

function prepareWorkspace(baseDir) {
  const workspace = path.join(baseDir, 'client-workspace');
  copySourceTemplate(workspace);
  initGitWorkspace(workspace);
  return workspace;
}

function createProject(baseDir, workspace) {
  const projectPath = path.join(baseDir, 'project.json');
  const result = parseJsonOutput(runNode([
    'tools/project-init/create-project.mjs',
    '--project-id', 'real-demand-client',
    '--name', 'Real Demand Client',
    '--description', '真实需求 E2E 客户端基座验证',
    '--base', `client:uniapp-template:https://example.com/client.git:${workspace}`,
    '--out', projectPath,
  ]));
  assert(result.ok === true, 'create-project 应成功');
  assert(fs.existsSync(projectPath), 'project.json 应生成');
  return projectPath;
}

function createFeature(baseDir, projectPath) {
  const featureDir = path.join(baseDir, 'features', 'client-announcement-tags');
  const result = parseJsonOutput(runNode([
    'tools/project-init/create-feature.mjs',
    '--feature-id', 'client-announcement-tags',
    '--name', '公告标签',
    '--summary', '在客户端工作台展示公告标签，并补充基座测试。',
    '--project', projectPath,
    '--bases', 'client',
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
  group.title = '公告标签客户端落地';
  group.tasks = [
    {
      id: 'TASK-001',
      title: scenario === 'client-review-violation' ? '越界修改检测' : '工作台公告标签',
      type: 'client',
      sourceStoryIds: [group.storyId],
      targetBaseId: 'client',
      dependsOn: [],
      requiredSkillId: 'uniapp-page-flow',
      scope: {
        summary: '在工作台页面增加公告标签，并补充客户端基座测试。',
        inScope: ['修改工作台页面文案。', '补充 foundation test 对公告标签的断言。'],
        outOfScope: ['不修改源模板。', '不接入真实后端。'],
      },
      allowedPaths: scenario === 'client-review-violation'
        ? ['pages-workspace/home/index.vue']
        : ['pages-workspace/home/index.vue', 'tests/foundation.test.js'],
      expectedChangedFiles: scenario === 'client-review-violation'
        ? ['pages-workspace/home/index.vue', 'config/app-config.js']
        : ['pages-workspace/home/index.vue', 'tests/foundation.test.js'],
      acceptanceCriteria: [
        {
          id: 'AC-001',
          text: '工作台页面包含 announcement-tag 标记。',
          verification: '运行 npm test 并检查 changedFiles/review 产物。',
        },
      ],
      checks: [
        {
          id: 'client-tests',
          name: '客户端基座测试',
          type: 'unit',
          command: 'npm test',
          required: true,
        },
      ],
      contextBudget: {
        size: 's',
        maxFiles: 3,
        maxEstimatedMinutes: 10,
      },
      retryPolicy: {
        maxAttempts: scenario === 'client-review-violation' ? 2 : 1,
      },
      humanNotes: 'Real demand E2E fixture task.',
    },
  ];
  writeJson(paths.taskPlan, taskPlan);

  const runState = readJson(paths.runState);
  runState.taskStates = {
    'TASK-001': {
      status: 'ready',
      attempts: 0,
      maxAttempts: scenario === 'client-review-violation' ? 2 : 1,
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
  const scriptPath = path.join(baseDir, `${scenario}-modifier.mjs`);
  const modifiesOutOfScope = scenario === 'client-review-violation';
  fs.writeFileSync(scriptPath, `import fs from 'node:fs';
const homePath = 'pages-workspace/home/index.vue';
let home = fs.readFileSync(homePath, 'utf8');
home = home.replace('<text class="desc">具备操作权限的用户可在此管理内容。</text>', '<text class="desc">具备操作权限的用户可在此管理内容。</text>\\n\\t\\t<text class="announcement-tag">公告标签</text>');
home = home.replace('</style>', '\\n\\t.announcement-tag {\\n\\t\\tdisplay: block;\\n\\t\\tmargin-top: 16rpx;\\n\\t\\tcolor: #1677ff;\\n\\t}\\n</style>');
fs.writeFileSync(homePath, home, 'utf8');
${modifiesOutOfScope
    ? "fs.appendFileSync('config/app-config.js', '\\n// out-of-scope review fixture\\n', 'utf8');"
    : "fs.appendFileSync('tests/foundation.test.js', \"\\ntest('workspace home should include announcement tag', () => {\\n  const content = readText('pages-workspace/home/index.vue')\\n  assert.match(content, /announcement-tag/)\\n})\\n\", 'utf8');"}
`, 'utf8');
  return scriptPath;
}

function runLoop(paths, args, modifierScript) {
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

function assertScenario(paths, scenario, adapter) {
  const taskContext = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'task-context.json'));
  const taskRun = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'task-run.json'));
  const attempt = taskRun.attempts[0];
  const review = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'review.json'));
  const runState = readJson(paths.runState);
  const loopSummary = readJson(paths.loopSummary);
  assert(taskContext.base.baseId === 'client', 'task-context 应指向 client 基座');
  assert(taskContext.base.workspaceAbs.includes('/engine-real-demand-e2e-'), 'task-context 应指向临时真实基座副本');
  assert(taskContext.task.requiredSkillId === 'uniapp-page-flow', 'task-context 应包含任务所需 skill');
  assert(taskContext.executionHints.checks.some((check) => check.id === 'client-tests'), 'task-context 应包含真实检查命令');

  if (scenario === 'client-review-violation') {
    assert(attempt.changedFiles.join(',') === 'config/app-config.js,pages-workspace/home/index.vue', '负向场景 changedFiles 应来自 git diff 并包含越界文件');
    assert(review.verdict === 'fail', '负向场景 review 应失败');
    assert(runState.taskStates['TASK-001'].status === 'review_failed', '负向场景 task 应 review_failed');
    assert(loopSummary.taskSummary.reviewFailed.includes('TASK-001'), '负向场景 loop-summary 应记录 reviewFailed');
    return {
      status: 'passed-negative',
      changedFiles: attempt.changedFiles,
      reviewVerdict: review.verdict,
      runStateStatus: runState.taskStates['TASK-001'].status,
    };
  }

  assert(attempt.status === 'passed', '默认场景 task-run attempt 应 passed');
  assert(attempt.agent.tool === adapter, `默认场景应使用 ${adapter} adapter`);
  assert(attempt.changedFiles.join(',') === 'pages-workspace/home/index.vue,tests/foundation.test.js', '默认场景 changedFiles 应只来自 git diff 的两个允许文件');
  assert(attempt.checks.some((check) => check.id === 'client-tests' && check.status === 'passed'), '默认场景 npm test check 应 passed');
  assert(review.verdict === 'pass', '默认场景 review 应 pass');
  assert(runState.taskStates['TASK-001'].status === 'done', '默认场景 task 应 done');
  assert(loopSummary.status === 'complete', '默认场景 loop-summary 应 complete');
  return {
    status: 'passed',
    changedFiles: attempt.changedFiles,
    reviewVerdict: review.verdict,
    runStateStatus: runState.taskStates['TASK-001'].status,
    loopSummaryStatus: loopSummary.status,
  };
}

function runRealDemandE2E(args) {
  const tmpRoot = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir();
  const baseDir = fs.mkdtempSync(path.join(tmpRoot, 'engine-real-demand-e2e-'));
  lastBaseDir = baseDir;
  const workspace = prepareWorkspace(baseDir);
  const projectPath = createProject(baseDir, workspace);
  const paths = createFeature(baseDir, projectPath);
  paths.projectPath = projectPath;
  patchTaskPlan(paths, args.scenario);
  const modifierScript = writeModifierScript(baseDir, args.scenario);
  const loopResult = runLoop(paths, args, modifierScript);
  const assertion = assertScenario(paths, args.scenario, args.adapter);
  return {
    ok: true,
    scenario: args.scenario,
    adapter: args.adapter,
    baseDir,
    workspace,
    projectPath,
    featureDir: paths.dir,
    loopSummaryPath: loopResult.loopSummaryPath,
    assertion,
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  let result;
  try {
    result = runRealDemandE2E(args);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    const cleanupDir = result?.baseDir ?? lastBaseDir;
    if (cleanupDir && !args.keepTmp) {
      fs.rmSync(cleanupDir, { recursive: true, force: true });
    }
  }
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

export { runRealDemandE2E };
