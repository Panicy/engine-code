#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
let lastBaseDir = null;

const scenarios = {
  'client-announcement-tags': {
    id: 'client-announcement-tags',
    name: '客户端公告标签',
    description: '复制 uniapp-template，修改工作台页面和客户端测试，运行真实 npm test。',
    templateId: 'uniapp-template',
    baseId: 'client',
    type: 'client',
    requiredSkillId: 'uniapp-page-flow',
    featureId: 'client-announcement-tags',
    featureName: '公告标签',
    featureSummary: '在客户端工作台展示公告标签，并补充基座测试。',
    projectId: 'real-demand-client',
    projectName: 'Real Demand Client',
    projectDescription: '真实需求 E2E 客户端基座验证',
    taskTitle: '工作台公告标签',
    taskSummary: '在工作台页面增加公告标签，并补充客户端基座测试。',
    inScope: ['修改工作台页面文案。', '补充 foundation test 对公告标签的断言。'],
    outOfScope: ['不修改源模板。', '不接入真实后端。'],
    allowedPaths: ['pages-workspace/home/index.vue', 'tests/foundation.test.js'],
    expectedChangedFiles: ['pages-workspace/home/index.vue', 'tests/foundation.test.js'],
    checks: [
      {
        id: 'client-tests',
        name: '客户端基座测试',
        type: 'unit',
        command: 'npm test',
        required: true,
      },
    ],
    acceptanceText: '工作台页面包含 announcement-tag 标记。',
    verification: '运行 npm test 并检查 changedFiles/review 产物。',
    contextBudget: { size: 's', maxFiles: 3, maxEstimatedMinutes: 10 },
    maxAttempts: 1,
    expectedStatus: 'done',
    expectedReview: 'pass',
    expectedLoopStatus: 'complete',
    modifierScript: () => `import fs from 'node:fs';
const homePath = 'pages-workspace/home/index.vue';
let home = fs.readFileSync(homePath, 'utf8');
home = home.replace('<text class="desc">具备操作权限的用户可在此管理内容。</text>', '<text class="desc">具备操作权限的用户可在此管理内容。</text>\\n\\t\\t<text class="announcement-tag">公告标签</text>');
home = home.replace('</style>', '\\n\\t.announcement-tag {\\n\\t\\tdisplay: block;\\n\\t\\tmargin-top: 16rpx;\\n\\t\\tcolor: #1677ff;\\n\\t}\\n</style>');
fs.writeFileSync(homePath, home, 'utf8');
fs.appendFileSync('tests/foundation.test.js', "\\ntest('workspace home should include announcement tag', () => {\\n  const content = readText('pages-workspace/home/index.vue')\\n  assert.match(content, /announcement-tag/)\\n})\\n", 'utf8');
`,
  },
  'client-review-violation': {
    id: 'client-review-violation',
    name: '客户端越界修改检测',
    description: '复制 uniapp-template，故意修改 allowedPaths 外文件，验证 review_failed。',
    templateId: 'uniapp-template',
    baseId: 'client',
    type: 'client',
    requiredSkillId: 'uniapp-page-flow',
    featureId: 'client-announcement-tags',
    featureName: '公告标签',
    featureSummary: '在客户端工作台展示公告标签，并补充基座测试。',
    projectId: 'real-demand-client-review',
    projectName: 'Real Demand Client Review',
    projectDescription: '真实需求 E2E 客户端越界审查验证',
    taskTitle: '越界修改检测',
    taskSummary: '在工作台页面增加公告标签，并故意修改越界文件。',
    inScope: ['修改工作台页面文案。'],
    outOfScope: ['不修改源模板。', '不修改 config/app-config.js。'],
    allowedPaths: ['pages-workspace/home/index.vue'],
    expectedChangedFiles: ['config/app-config.js', 'pages-workspace/home/index.vue'],
    checks: [
      {
        id: 'client-tests',
        name: '客户端基座测试',
        type: 'unit',
        command: 'npm test',
        required: true,
      },
    ],
    acceptanceText: '工作台页面包含 announcement-tag 标记。',
    verification: '运行 npm test 并检查 review 越界结果。',
    contextBudget: { size: 's', maxFiles: 3, maxEstimatedMinutes: 10 },
    maxAttempts: 2,
    expectedStatus: 'review_failed',
    expectedReview: 'fail',
    expectedLoopStatus: 'has_exceptions',
    expectedSummaryKey: 'reviewFailed',
    modifierScript: () => `import fs from 'node:fs';
const homePath = 'pages-workspace/home/index.vue';
let home = fs.readFileSync(homePath, 'utf8');
home = home.replace('<text class="desc">具备操作权限的用户可在此管理内容。</text>', '<text class="desc">具备操作权限的用户可在此管理内容。</text>\\n\\t\\t<text class="announcement-tag">公告标签</text>');
home = home.replace('</style>', '\\n\\t.announcement-tag {\\n\\t\\tdisplay: block;\\n\\t\\tmargin-top: 16rpx;\\n\\t\\tcolor: #1677ff;\\n\\t}\\n</style>');
fs.writeFileSync(homePath, home, 'utf8');
fs.appendFileSync('config/app-config.js', '\\n// out-of-scope review fixture\\n', 'utf8');
`,
  },
  'backend-sql-migration-smoke': {
    id: 'backend-sql-migration-smoke',
    name: '后端 SQL 迁移轻量场景',
    description: '复制 backend-starter，新增 SQL 迁移文件，用 node -e 做静态内容断言。',
    templateId: 'backend-starter',
    baseId: 'backend',
    type: 'schema',
    requiredSkillId: 'ruoyi-database-migration',
    featureId: 'backend-sql-migration-smoke',
    featureName: '公告标签数据表',
    featureSummary: '为公告标签新增后端数据库迁移脚本。',
    projectId: 'real-demand-backend',
    projectName: 'Real Demand Backend',
    projectDescription: '真实需求 E2E 后端基座验证',
    taskTitle: '公告标签 SQL 迁移',
    taskSummary: '新增公告标签业务表和菜单权限 SQL 草案。',
    inScope: ['新增 script/sql/engine_e2e_notice_tag.sql。', '包含业务表和权限码。'],
    outOfScope: ['不运行 Maven。', '不启动后端。', '不连接数据库。'],
    allowedPaths: ['script/sql/engine_e2e_notice_tag.sql'],
    expectedChangedFiles: ['script/sql/engine_e2e_notice_tag.sql'],
    checks: [
      {
        id: 'backend-sql-static',
        name: '后端 SQL 静态断言',
        type: 'command',
        command: 'node -e "const fs=require(\'fs\'); const sql=fs.readFileSync(\'script/sql/engine_e2e_notice_tag.sql\',\'utf8\'); if(!sql.includes(\'engine_notice_tag\') || !sql.includes(\'system:noticeTag:list\')) process.exit(1)"',
        required: true,
      },
    ],
    acceptanceText: 'SQL 文件包含 engine_notice_tag 表和 system:noticeTag:list 权限码。',
    verification: '运行 node -e 静态断言并检查 changedFiles/review 产物。',
    contextBudget: { size: 's', maxFiles: 2, maxEstimatedMinutes: 10 },
    maxAttempts: 1,
    expectedStatus: 'done',
    expectedReview: 'pass',
    expectedLoopStatus: 'complete',
    modifierScript: () => `import fs from 'node:fs';
fs.mkdirSync('script/sql', { recursive: true });
fs.writeFileSync('script/sql/engine_e2e_notice_tag.sql', \`-- Engine real demand E2E notice tag migration
CREATE TABLE engine_notice_tag (
  id bigint NOT NULL COMMENT '主键',
  tag_name varchar(64) NOT NULL COMMENT '标签名称',
  tag_color varchar(32) DEFAULT NULL COMMENT '标签颜色',
  create_time datetime DEFAULT NULL COMMENT '创建时间',
  PRIMARY KEY (id)
) COMMENT='公告标签';

INSERT INTO sys_menu(menu_name, perms, menu_type) VALUES ('公告标签查询', 'system:noticeTag:list', 'F');
\`, 'utf8');
`,
  },
  'middle-notice-page-smoke': {
    id: 'middle-notice-page-smoke',
    name: '中台公告标签页面轻量场景',
    description: '复制 middle-starter，新增 Vben 页面和 API 封装，用 node -e 做静态内容断言。',
    templateId: 'middle-starter',
    baseId: 'middle',
    type: 'middle',
    requiredSkillId: 'vben-table-form-page',
    featureId: 'middle-notice-page-smoke',
    featureName: '公告标签中台页',
    featureSummary: '为公告标签新增中台列表页面和 API 封装。',
    projectId: 'real-demand-middle',
    projectName: 'Real Demand Middle',
    projectDescription: '真实需求 E2E 中台基座验证',
    taskTitle: '公告标签中台页面',
    taskSummary: '新增公告标签 API 封装和轻量页面入口。',
    inScope: ['新增 apps/web-antd/src/api/system/notice-tag/index.ts。', '新增 apps/web-antd/src/views/system/notice-tag/index.vue。'],
    outOfScope: ['不运行 pnpm install。', '不运行中台构建。', '不启动前端服务。'],
    allowedPaths: [
      'apps/web-antd/src/api/system/notice-tag/index.ts',
      'apps/web-antd/src/views/system/notice-tag/index.vue',
    ],
    expectedChangedFiles: [
      'apps/web-antd/src/api/system/notice-tag/index.ts',
      'apps/web-antd/src/views/system/notice-tag/index.vue',
    ],
    checks: [
      {
        id: 'middle-page-static',
        name: '中台页面静态断言',
        type: 'command',
        command: 'node -e "const fs=require(\'fs\'); const page=fs.readFileSync(\'apps/web-antd/src/views/system/notice-tag/index.vue\',\'utf8\'); const api=fs.readFileSync(\'apps/web-antd/src/api/system/notice-tag/index.ts\',\'utf8\'); if(!page.includes(\'system:noticeTag:list\') || !api.includes(\'/system/noticeTag/list\')) process.exit(1)"',
        required: true,
      },
    ],
    acceptanceText: '中台页面包含 system:noticeTag:list 权限码，API 封装包含 /system/noticeTag/list。',
    verification: '运行 node -e 静态断言并检查 changedFiles/review 产物。',
    contextBudget: { size: 's', maxFiles: 3, maxEstimatedMinutes: 10 },
    maxAttempts: 1,
    expectedStatus: 'done',
    expectedReview: 'pass',
    expectedLoopStatus: 'complete',
    modifierScript: () => `import fs from 'node:fs';
fs.mkdirSync('apps/web-antd/src/api/system/notice-tag', { recursive: true });
fs.writeFileSync('apps/web-antd/src/api/system/notice-tag/index.ts', \`import { requestClient } from '#/api/request';

export function listNoticeTag(params?: Record<string, unknown>) {
  return requestClient.get('/system/noticeTag/list', { params });
}
\`, 'utf8');
fs.mkdirSync('apps/web-antd/src/views/system/notice-tag', { recursive: true });
fs.writeFileSync('apps/web-antd/src/views/system/notice-tag/index.vue', \`<script setup lang="ts">
import { listNoticeTag } from '#/api/system/notice-tag';

defineOptions({ name: 'NoticeTagPage' });

void listNoticeTag;
</script>

<template>
  <Page title="公告标签">
    <a-button v-access="'system:noticeTag:list'">查询公告标签</a-button>
  </Page>
</template>
\`, 'utf8');
`,
  },
};

function usage() {
  return [
    '用法：node tools/e2e/run-real-demand-e2e.mjs',
    '',
    '可选：',
    '  --list-scenarios',
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

function sourceTemplatePath(templateId) {
  return path.resolve(repoRoot, '.engine/source-templates', templateId);
}

function copySourceTemplate(templateId, workspace) {
  const sourceTemplate = sourceTemplatePath(templateId);
  assert(fs.existsSync(sourceTemplate), `source template 不存在：${sourceTemplate}`);
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
  const workspace = path.join(baseDir, `${scenario.baseId}-workspace`);
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

export { runRealDemandE2E, listScenarios };
