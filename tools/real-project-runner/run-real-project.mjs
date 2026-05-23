#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scenarios as realDemandScenarios } from '../e2e/real-demand-scenarios/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const fixedBases = [
  {
    baseId: 'backend',
    templateId: 'backend-starter',
    repo: 'https://gitee.com/Panicy/backend-starter',
  },
  {
    baseId: 'middle',
    templateId: 'middle-starter',
    repo: 'https://gitee.com/Panicy/middle-starter',
  },
  {
    baseId: 'client',
    templateId: 'uniapp-template',
    repo: 'https://gitee.com/Panicy/uniapp-template',
  },
];

function usage() {
  return [
    '用法：node tools/real-project-runner/run-real-project.mjs',
    '',
    '可选：',
    '  --project-id real-project-smoke',
    '  --project-name <name>',
    '  --tmp-root /private/tmp',
    '  --keep-tmp',
    '  --clone-mode git|source-template',
    '  --skip-bootstrap',
    '  --mysql-command /usr/local/mysql/bin/mysql',
    '  --mysql-user root',
    '  --mysql-password-env MYSQL_PWD',
    '  --database aitest',
    '  --redis-url redis://default:***@127.0.0.1:6379',
    '  --adapter shell|codex',
    '  --codex-command codex',
    '',
    '默认 clone 固定 Gitee 基座，执行 backend bootstrap 和真实需求 smoke 场景。',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    'project-id': 'real-project-smoke',
    'project-name': 'Real Project Smoke',
    'tmp-root': fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir(),
    'clone-mode': 'git',
    adapter: 'shell',
    database: 'aitest',
    'mysql-command': 'mysql',
    'mysql-user': 'root',
  };
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
    if (arg === '--skip-bootstrap') {
      args.skipBootstrap = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    const key = arg.slice(2);
    const allowed = new Set([
      'project-id',
      'project-name',
      'tmp-root',
      'clone-mode',
      'mysql-command',
      'mysql-host',
      'mysql-port',
      'mysql-user',
      'mysql-password-env',
      'mysql-password-source',
      'database',
      'redis-url',
      'redis-command',
      'adapter',
      'codex-command',
    ]);
    if (!allowed.has(key)) throw new Error(`未知参数：${arg}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${arg} 缺少值`);
    args[key] = value;
    i += 1;
  }
  if (!['git', 'source-template'].includes(args['clone-mode'])) {
    throw new Error('--clone-mode 必须是 git 或 source-template。');
  }
  if (!['shell', 'codex'].includes(args.adapter)) {
    throw new Error('--adapter 必须是 shell 或 codex。');
  }
  return args;
}

function assertInside(parent, child, message) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(message);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 300000,
    maxBuffer: 1024 * 1024 * 20,
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

function runAllowFailure(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 300000,
    maxBuffer: 1024 * 1024 * 20,
  });
}

function runNode(args, options = {}) {
  return run(process.execPath, args, options);
}

function parseJson(result) {
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
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function gitRemote(workspace) {
  const result = run('git', ['remote', 'get-url', 'origin'], { cwd: workspace });
  return result.stdout.trim();
}

function prepareBaseWorkspace(root, base, cloneMode) {
  const workspace = path.join(root, base.baseId);
  assertInside(root, workspace, `base workspace 越界：${workspace}`);
  if (cloneMode === 'git') {
    run('git', ['clone', '--depth', '1', base.repo, workspace], { timeoutMs: 600000 });
  } else {
    const source = path.resolve(repoRoot, '.engine/source-templates', base.templateId);
    if (!fs.existsSync(source)) throw new Error(`source template 不存在：${source}`);
    fs.cpSync(source, workspace, {
      recursive: true,
      filter: (sourcePath) => !sourcePath.includes(`${path.sep}.git${path.sep}`) && !sourcePath.endsWith(`${path.sep}.git`),
    });
    run('git', ['init'], { cwd: workspace });
    run('git', ['config', 'user.email', 'real-project-runner@example.test'], { cwd: workspace });
    run('git', ['config', 'user.name', 'Real Project Runner'], { cwd: workspace });
    run('git', ['remote', 'add', 'origin', base.repo], { cwd: workspace });
    run('git', ['add', '.'], { cwd: workspace });
    run('git', ['commit', '-m', 'baseline'], { cwd: workspace });
  }
  return workspace;
}

function createProject(root, args, workspaces) {
  const projectPath = path.join(root, 'project.json');
  const commandArgs = [
    'tools/project-init/create-project.mjs',
    '--project-id',
    args['project-id'],
    '--name',
    args['project-name'],
    '--description',
    'Real project runner smoke project.',
    '--out',
    projectPath,
  ];
  for (const base of fixedBases) {
    commandArgs.push('--base', `${base.baseId}:${base.templateId}:${base.repo}:${workspaces[base.baseId]}`);
  }
  const result = parseJson(runNode(commandArgs));
  if (result.ok !== true) throw new Error('create-project 未成功。');
  return projectPath;
}

function runBootstrap(root, args, backendWorkspace) {
  const outputPath = path.join(root, '.engine/bootstrap-state/backend.json');
  if (args.skipBootstrap) {
    return {
      skipped: true,
      outputPath,
      state: null,
    };
  }
  const commandArgs = [
    'tools/base-bootstrap/bootstrap-backend.mjs',
    '--project-id',
    args['project-id'],
    '--base-id',
    'backend',
    '--workspace',
    backendWorkspace,
    '--database',
    args.database,
    '--out',
    outputPath,
    '--mysql-command',
    args['mysql-command'],
    '--mysql-user',
    args['mysql-user'],
  ];
  for (const key of ['mysql-host', 'mysql-port', 'mysql-password-env', 'mysql-password-source', 'redis-url', 'redis-command']) {
    if (args[key]) commandArgs.push(`--${key}`, args[key]);
  }
  const result = runAllowFailure(process.execPath, commandArgs, { timeoutMs: 300000 });
  const report = result.stdout ? parseJson({ stdout: result.stdout }) : null;
  if (result.status !== 0 && report?.state?.state !== 'needs_human') {
    throw new Error([
      `backend bootstrap 命令失败：node ${commandArgs.join(' ')}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join('\n'));
  }
  return {
    skipped: false,
    outputPath,
    exitCode: result.status,
    ok: report?.ok === true,
    state: report?.state?.state ?? null,
    issues: report?.state?.issues ?? [],
    checks: report?.state?.checks ?? [],
  };
}

function createFeature(root, projectPath, scenario) {
  const featureDir = path.join(root, 'features', scenario.featureId);
  const result = parseJson(runNode([
    'tools/project-init/create-feature.mjs',
    '--feature-id',
    scenario.featureId,
    '--name',
    scenario.featureName,
    '--summary',
    scenario.featureSummary,
    '--project',
    projectPath,
    '--bases',
    scenario.baseId,
    '--out-dir',
    featureDir,
    '--approve-prd-by',
    'real-project-runner',
    '--approve-task-plan-by',
    'real-project-runner',
  ]));
  if (result.ok !== true || result.validationPassed !== true) {
    throw new Error(`create-feature 未成功：${JSON.stringify(result, null, 2)}`);
  }
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
      humanNotes: `Real project runner task: ${scenario.id}.`,
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

function writeModifierScript(root, scenario) {
  const scriptPath = path.join(root, `${scenario.id}-modifier.mjs`);
  fs.writeFileSync(scriptPath, scenario.modifierScript(), 'utf8');
  return scriptPath;
}

function runLoop(projectPath, paths, args, modifierScript) {
  const adapterArgs = args.adapter === 'codex'
    ? ['--agent-adapter', 'codex', '--codex-command', args['codex-command'] ?? 'codex', '--codex-extra-arg', 'exec']
    : ['--agent-adapter', 'shell', '--shell-command', `${process.execPath} ${modifierScript}`];
  return parseJson(runNode([
    'tools/run-loop/run-feature.mjs',
    '--project',
    projectPath,
    '--prd',
    paths.prd,
    '--task-plan',
    paths.taskPlan,
    '--run-state',
    paths.runState,
    '--checks-mode',
    'real',
    '--max-tasks',
    '1',
    ...adapterArgs,
  ], { timeoutMs: 600000 }));
}

function assertScenario(paths, scenario, adapter, workspace) {
  const taskContextPath = path.join(paths.dir, 'runs', 'TASK-001', 'task-context.json');
  const taskRunPath = path.join(paths.dir, 'runs', 'TASK-001', 'task-run.json');
  const reviewPath = path.join(paths.dir, 'runs', 'TASK-001', 'review.json');
  const taskContext = readJson(taskContextPath);
  const taskRun = readJson(taskRunPath);
  const review = readJson(reviewPath);
  const runState = readJson(paths.runState);
  const loopSummary = readJson(paths.loopSummary);
  const attempt = taskRun.attempts[0];
  assert(taskContext.base.workspaceAbs === workspace, 'task-context 应指向 runner 克隆出的固定基座 workspace');
  assert(attempt.agent.tool === adapter, `场景应使用 ${adapter} adapter`);
  assert(attempt.changedFiles.join(',') === scenario.expectedChangedFiles.join(','), 'changedFiles 应符合场景预期');
  assert(review.verdict === scenario.expectedReview, `review 应为 ${scenario.expectedReview}`);
  assert(runState.taskStates['TASK-001'].status === scenario.expectedStatus, `task 应为 ${scenario.expectedStatus}`);
  assert(loopSummary.status === scenario.expectedLoopStatus, `loop-summary 应为 ${scenario.expectedLoopStatus}`);
  return {
    status: scenario.expectedReview === 'pass' ? 'passed' : 'passed-negative',
    changedFiles: attempt.changedFiles,
    reviewVerdict: review.verdict,
    runStateStatus: runState.taskStates['TASK-001'].status,
    loopSummaryStatus: loopSummary.status,
  };
}

function runScenario(root, projectPath, workspaces, args, scenarioId) {
  const scenario = realDemandScenarios[scenarioId];
  const paths = createFeature(root, projectPath, scenario);
  patchTaskPlan(paths, scenario);
  const modifierScript = writeModifierScript(root, scenario);
  const loopResult = runLoop(projectPath, paths, args, modifierScript);
  const assertion = assertScenario(paths, scenario, args.adapter, workspaces[scenario.baseId]);
  return {
    scenario: scenarioId,
    ok: true,
    workspace: workspaces[scenario.baseId],
    featureDir: paths.dir,
    loopSummaryPath: loopResult.loopSummaryPath,
    assertion,
  };
}

function runRealProject(args) {
  const tmpRoot = path.resolve(args['tmp-root']);
  fs.mkdirSync(tmpRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(tmpRoot, 'engine-real-project-runner-'));
  const workspaces = {};
  const remotes = {};
  let cleanup = true;
  try {
    for (const base of fixedBases) {
      const workspace = prepareBaseWorkspace(root, base, args['clone-mode']);
      workspaces[base.baseId] = workspace;
      remotes[base.baseId] = gitRemote(workspace);
    }
    const projectPath = createProject(root, args, workspaces);
    const bootstrap = runBootstrap(root, args, workspaces.backend);
    const scenarios = [
      runScenario(root, projectPath, workspaces, args, 'backend-sql-migration-smoke'),
      runScenario(root, projectPath, workspaces, args, 'middle-notice-page-smoke'),
      runScenario(root, projectPath, workspaces, args, 'client-announcement-tags'),
    ];
    const report = {
      ok: scenarios.every((item) => item.ok) && (bootstrap.skipped || bootstrap.state === 'ready'),
      root,
      projectPath,
      cloneMode: args['clone-mode'],
      remotes,
      workspaces,
      bootstrap,
      scenarios,
      generatedAt: new Date().toISOString(),
    };
    const reportPath = path.join(root, 'real-project-report.json');
    report.reportPath = reportPath;
    writeJson(reportPath, report);
    cleanup = false;
    if (!args.keepTmp) {
      report.cleanupNote = 'runner 结果默认保留到临时目录，便于审计；如需手动清理可删除 root。';
      writeJson(reportPath, report);
    }
    return report;
  } finally {
    if (cleanup && !args.keepTmp) fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help) {
      console.log(usage());
      return;
    }
    const result = runRealProject(args);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }
}

if (process.argv[1] && __filename === path.resolve(process.argv[1])) {
  main();
}

export { runRealProject, fixedBases };
