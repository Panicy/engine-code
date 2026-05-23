#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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
  const schemaIndex = readJson(path.resolve(repoRoot, '.engine/json/schema-index.json'));
  for (const schema of schemaIndex.schemas ?? []) {
    const schemaPath = path.resolve(repoRoot, schema.path);
    assert(fs.existsSync(schemaPath), `schema-index 引用的 schema 不存在：${schema.path}`);
  }
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

function backendApiFixture(overrides = {}) {
  return {
    schemaVersion: '0.1.0',
    featureId: 'notice-tags',
    generatedAt: '2026-05-22T12:00:00+08:00',
    endpoints: [
      {
        id: 'notice-tag-list',
        method: 'GET',
        path: '/system/noticeTag/list',
        description: '分页查询公告标签。',
        permissionCode: 'system:noticeTag:list',
        authRequired: true,
        request: {
          query: [
            { name: 'pageNum', type: 'number', required: true, description: '页码。' },
            { name: 'pageSize', type: 'number', required: true, description: '每页数量。' },
          ],
          path: [],
          bodyType: '',
        },
        response: { wrapper: 'TableDataInfo', dataType: 'NoticeTagVo' },
      },
      {
        id: 'notice-tag-add',
        method: 'POST',
        path: '/system/noticeTag',
        description: '新增公告标签。',
        permissionCode: 'system:noticeTag:add',
        authRequired: true,
        request: { query: [], path: [], bodyType: 'NoticeTagBo' },
        response: { wrapper: 'R', dataType: 'boolean' },
      },
    ],
    ...overrides,
  };
}

function permissionManifestFixture(overrides = {}) {
  return {
    schemaVersion: '0.1.0',
    featureId: 'notice-tags',
    generatedAt: '2026-05-22T12:00:00+08:00',
    permissions: [
      {
        code: 'system:noticeTag:list',
        action: 'list',
        backendAnnotation: true,
        menuSql: true,
        middleButton: true,
        targetEndpointIds: ['notice-tag-list'],
        notes: '公告标签查询权限。',
      },
      {
        code: 'system:noticeTag:add',
        action: 'add',
        backendAnnotation: true,
        menuSql: true,
        middleButton: true,
        targetEndpointIds: ['notice-tag-add'],
        notes: '公告标签新增权限。',
      },
    ],
    ...overrides,
  };
}

function writeContractFixtures(baseDir, name, backendApi, permissions) {
  const dir = path.join(baseDir, 'contracts', name);
  fs.mkdirSync(dir, { recursive: true });
  const backendApiPath = path.join(dir, 'backend-api.json');
  const permissionsPath = path.join(dir, 'permission-manifest.json');
  writeJsonFile(backendApiPath, backendApi);
  writeJsonFile(permissionsPath, permissions);
  return { backendApiPath, permissionsPath };
}

function runContractsValidator(backendApiPath, permissionsPath, options = {}) {
  const args = [
    'tools/contracts/validate-contracts.mjs',
    '--backend-api', backendApiPath,
    '--permissions', permissionsPath,
  ];
  const result = runNode(args, { expectFailure: options.expectFailure });
  return { result, report: parseCommandJson(result) };
}

function assertContractsInvalid(baseDir, name, backendApi, permissions, expectedCode) {
  const paths = writeContractFixtures(baseDir, name, backendApi, permissions);
  const { result, report } = runContractsValidator(paths.backendApiPath, paths.permissionsPath, { expectFailure: true });
  assert(result.status === 1, `${name} 应以 exit 1 表示契约校验失败`);
  assert(report.valid === false, `${name} report.valid 应为 false`);
  assert(report.errors.some((item) => item.code === expectedCode), `${name} 应包含错误码 ${expectedCode}`);
}

function testContractsValidator(baseDir) {
  const validPaths = writeContractFixtures(baseDir, 'contracts-valid', backendApiFixture(), permissionManifestFixture());
  const valid = runContractsValidator(validPaths.backendApiPath, validPaths.permissionsPath);
  assert(valid.report.valid === true, '合法 backend-api 和 permission-manifest 应通过');

  assertContractsInvalid(baseDir, 'contracts-missing-permission', backendApiFixture({
    endpoints: [
      ...backendApiFixture().endpoints,
      {
        id: 'notice-tag-remove',
        method: 'DELETE',
        path: '/system/noticeTag/{id}',
        description: '删除公告标签。',
        permissionCode: 'system:noticeTag:remove',
        authRequired: true,
        request: { query: [], path: [{ name: 'id', type: 'number', required: true, description: '主键。' }], bodyType: '' },
        response: { wrapper: 'R', dataType: 'boolean' },
      },
    ],
  }), permissionManifestFixture(), 'API_PERMISSION_NOT_FOUND');

  assertContractsInvalid(baseDir, 'contracts-duplicated-permission', backendApiFixture(), permissionManifestFixture({
    permissions: [
      ...permissionManifestFixture().permissions,
      {
        code: 'system:noticeTag:list',
        action: 'query',
        backendAnnotation: true,
        menuSql: true,
        middleButton: false,
        targetEndpointIds: [],
        notes: '重复权限码。',
      },
    ],
  }), 'PERMISSION_CODE_DUPLICATED');

  assertContractsInvalid(baseDir, 'contracts-duplicated-operation', backendApiFixture({
    endpoints: [
      ...backendApiFixture().endpoints,
      {
        ...backendApiFixture().endpoints[0],
        path: '/system/noticeTag/duplicated-id',
      },
    ],
  }), permissionManifestFixture(), 'API_OPERATION_DUPLICATED');

  assertContractsInvalid(baseDir, 'contracts-duplicated-route', backendApiFixture({
    endpoints: [
      ...backendApiFixture().endpoints,
      {
        ...backendApiFixture().endpoints[0],
        id: 'notice-tag-list-copy',
      },
    ],
  }), permissionManifestFixture(), 'API_ROUTE_DUPLICATED');

  assertContractsInvalid(baseDir, 'contracts-target-missing', backendApiFixture(), permissionManifestFixture({
    permissions: [
      {
        ...permissionManifestFixture().permissions[0],
        targetEndpointIds: ['missing-operation'],
      },
      permissionManifestFixture().permissions[1],
    ],
  }), 'PERMISSION_TARGET_ENDPOINT_NOT_FOUND');

  assertContractsInvalid(baseDir, 'contracts-target-code-mismatch', backendApiFixture(), permissionManifestFixture({
    permissions: [
      {
        ...permissionManifestFixture().permissions[0],
        code: 'system:noticeTag:query',
      },
      permissionManifestFixture().permissions[1],
    ],
  }), 'PERMISSION_TARGET_CODE_MISMATCH');

  assertContractsInvalid(baseDir, 'contracts-schema-invalid-method', backendApiFixture({
    endpoints: [
      {
        ...backendApiFixture().endpoints[0],
        method: 'OPTIONS',
      },
    ],
  }), permissionManifestFixture(), 'SCHEMA_ENUM_MISMATCH');

  const readFailed = runNode([
    'tools/contracts/validate-contracts.mjs',
    '--backend-api', path.join(baseDir, 'missing-backend-api.json'),
    '--permissions', validPaths.permissionsPath,
  ], { expectFailure: true });
  const readFailedReport = parseCommandJson(readFailed);
  assert(readFailed.status === 2, 'JSON 读取失败应 exit 2');
  assert(readFailedReport.errors.some((item) => item.code === 'CONTRACTS_READ_FAILED'), 'JSON 读取失败应返回 CONTRACTS_READ_FAILED');
}

function testContractsValidatorCwd(baseDir) {
  const workspace = path.join(baseDir, 'contracts-cwd-workspace');
  const contractsDir = path.join(workspace, 'engine-contracts/notice-tags');
  fs.mkdirSync(contractsDir, { recursive: true });
  writeJsonFile(path.join(contractsDir, 'backend-api.json'), backendApiFixture());
  writeJsonFile(path.join(contractsDir, 'permission-manifest.json'), permissionManifestFixture());
  const result = runNode([
    'tools/contracts/validate-contracts.mjs',
    '--cwd', workspace,
    '--backend-api', 'engine-contracts/notice-tags/backend-api.json',
    '--permissions', 'engine-contracts/notice-tags/permission-manifest.json',
  ]);
  const report = parseCommandJson(result);
  assert(report.valid === true, 'validate-contracts --cwd 应按 workspace 解析相对路径');
  assert(report.files.backendApi === path.join(contractsDir, 'backend-api.json'), 'backend-api 文件路径应解析到 workspace 内');
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

function testSkillTaskTypeMismatch(baseDir) {
  const paths = prepareApprovedFeature(baseDir, 'skill-task-type-mismatch');
  const taskPlan = readJson(paths.taskPlan);
  const task = taskPlan.storyGroups[0].tasks[0];
  task.type = 'backend';
  task.requiredSkillId = 'ruoyi-database-migration';
  writeJsonFile(paths.taskPlan, taskPlan);
  const report = validateFiles({
    project: paths.projectPath ?? projectPath,
    prd: paths.prd,
    'task-plan': paths.taskPlan,
    'run-state': paths.runState,
    'templates-dir': templatesDir,
  });
  assert(report.valid === false, 'task.type 与 skill.appliesTo.taskTypes 不匹配时应校验失败');
  assert(report.errors.some((item) => item.code === 'TASK_SKILL_TYPE_MISMATCH'), '应返回 TASK_SKILL_TYPE_MISMATCH');
}

function writeFakeMysql(baseDir, mode) {
  const scriptPath = path.join(baseDir, `fake-mysql-${mode}.mjs`);
  fs.writeFileSync(scriptPath, `#!/usr/bin/env node
const mode = ${JSON.stringify(mode)};
const sqlIndex = process.argv.indexOf('-e');
const sql = sqlIndex >= 0 ? process.argv[sqlIndex + 1] : '';
const tables = {
  ready: ['sys_client','sys_config','sys_dept','sys_dict_data','sys_dict_type','sys_menu','sys_role','sys_role_menu','sys_user','sys_user_role'],
  partial: ['sys_menu','sys_role','sys_user'],
  empty: []
};
if (sql.includes('information_schema.SCHEMATA')) {
  console.log('aitest');
  process.exit(0);
}
if (sql.includes('information_schema.TABLES')) {
  for (const table of tables[mode] || []) console.log(table);
  process.exit(0);
}
if (sql.startsWith('CREATE DATABASE')) process.exit(0);
process.exit(0);
`, 'utf8');
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function writeFakeRedis(baseDir) {
  const scriptPath = path.join(baseDir, 'fake-redis-cli.mjs');
  fs.writeFileSync(scriptPath, `#!/usr/bin/env node
console.log('PONG');
`, 'utf8');
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function createBackendBootstrapWorkspace(baseDir) {
  const workspace = path.join(baseDir, `bootstrap-workspace-${Date.now()}`);
  fs.mkdirSync(path.join(workspace, 'script/sql'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'script/sql/ry_vue_5.X.sql'), '-- baseline sql\n', 'utf8');
  return workspace;
}

function testBaseBootstrapReadyAndPartial(baseDir) {
  const redisCommand = writeFakeRedis(baseDir);
  const readyWorkspace = createBackendBootstrapWorkspace(baseDir);
  const readyOut = path.join(baseDir, 'bootstrap-ready.json');
  const ready = runNode([
    'tools/base-bootstrap/bootstrap-backend.mjs',
    '--project-id', 'bootstrap-e2e',
    '--base-id', 'backend',
    '--workspace', readyWorkspace,
    '--database', 'aitest',
    '--out', readyOut,
    '--mysql-command', writeFakeMysql(baseDir, 'ready'),
    '--redis-command', redisCommand,
    '--redis-url', 'redis://default:redacted@127.0.0.1:6379',
  ]);
  const readyReport = parseCommandJson(ready);
  assert(readyReport.ok === true, '完整基座应 ready');
  assert(readJson(readyOut).state === 'ready', '完整基座输出 state=ready');

  const partialWorkspace = createBackendBootstrapWorkspace(baseDir);
  const partialOut = path.join(baseDir, 'bootstrap-partial.json');
  const partial = runNode([
    'tools/base-bootstrap/bootstrap-backend.mjs',
    '--project-id', 'bootstrap-e2e',
    '--base-id', 'backend',
    '--workspace', partialWorkspace,
    '--database', 'aitest',
    '--out', partialOut,
    '--mysql-command', writeFakeMysql(baseDir, 'partial'),
    '--redis-command', redisCommand,
    '--redis-url', 'redis://default:redacted@127.0.0.1:6379',
  ], { expectFailure: true });
  const partialReport = parseCommandJson(partial);
  assert(partialReport.ok === false, '残缺基座应失败并需要人工处理');
  const partialState = readJson(partialOut);
  assert(partialState.state === 'needs_human', '残缺基座输出 state=needs_human');
  assert(partialState.issues.some((item) => item.code === 'BASELINE_PARTIAL'), '残缺基座应记录 BASELINE_PARTIAL');
}

function testRealProjectRunnerSourceTemplate() {
  const result = parseCommandJson(runNode([
    'tools/real-project-runner/run-real-project.mjs',
    '--clone-mode',
    'source-template',
    '--skip-bootstrap',
    '--adapter',
    'shell',
  ]));
  assert(result.ok === true, 'real-project-runner source-template 模式应通过');
  assert(result.scenarios.length === 3, 'real-project-runner 应运行 3 个 smoke 场景');
  for (const item of result.scenarios) {
    assert(item.ok === true, `场景 ${item.scenario} 应通过`);
    assert(item.workspace.startsWith(result.root), `场景 ${item.scenario} 应使用 runner 自己的 workspace`);
    assert(item.featureDir.startsWith(result.root), `场景 ${item.scenario} feature 应位于 runner root`);
  }
}

function writeRichRequirements(baseDir, overrides = {}) {
  const requirements = {
    impactedBaseIds: ['client', 'backend', 'middle'],
    goals: ['管理员可以维护公告标签。'],
    nonGoals: ['不实现公告智能推荐。'],
    personas: [
      {
        id: 'admin-user',
        name: '后台管理员',
        description: '负责维护公告标签和公告分类的人。',
      },
      {
        name: '业务用户',
        description: '在客户端查看公告并识别公告类型的人。',
      },
    ],
    userStories: [
      {
        title: '管理员维护公告标签',
        story: '作为管理员，我希望维护公告标签，以便对公告进行分类。',
        acceptanceCriteria: [
          {
            text: '管理员可以新增公告标签。',
            verification: '后端接口和中台页面均可完成新增。',
          },
        ],
        priority: 'must',
      },
      {
        title: '业务端查看公告标签',
        story: '作为业务用户，我希望查看公告标签，以便快速识别公告类型。',
        acceptanceCriteria: ['业务端列表展示公告标签。'],
        priority: 'should',
        dependencies: ['US-001'],
      },
    ],
    businessRules: ['公告标签名称在同一租户下不可重复。'],
    dataEntities: [
      {
        name: '公告标签',
        description: '用于标记公告类型。',
        fields: [
          { name: 'tagName', type: 'string', required: true, description: '标签名称' },
          { name: 'tagColor', type: 'string', required: false, description: '标签颜色' },
        ],
      },
    ],
    permissions: [
      {
        code: 'system:noticeTag:list',
        name: '公告标签查询',
        targetBaseId: 'backend',
      },
    ],
    assumptions: ['一期只支持后台维护公告标签。'],
    openQuestions: [
      {
        question: '公告标签是否需要导出？',
        status: 'open',
      },
    ],
    risks: [
      {
        description: '历史公告数据可能缺少标签。',
        mitigation: '上线前通过默认标签兜底。',
      },
    ],
    constraints: {
      security: ['公告标签接口必须保留权限码。'],
      ux: ['中台页面沿用现有表格表单模式。'],
      performance: ['列表查询需要支持分页。'],
      quality: ['必须验证 401/403/404。'],
    },
    ...overrides,
  };
  const filePath = path.join(baseDir, `requirements-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  writeJsonFile(filePath, requirements);
  return filePath;
}

function createPrdFromRequirements(baseDir, featureId, requirementsPath) {
  const prdPath = path.join(baseDir, `${featureId}-prd.json`);
  const result = parseCommandJson(runNode([
    'tools/prd-builder/create-prd.mjs',
    '--feature-id', featureId,
    '--name', '公告标签',
    '--summary', '支持管理员维护公告标签并在业务端展示。',
    '--project', projectPath,
    '--requirements-file', requirementsPath,
    '--out', prdPath,
    '--force',
  ]));
  assert(result.ok === true, 'requirements-file 生成 PRD 应成功');
  return prdPath;
}

function assertInvalidRequirements(baseDir, featureId, requirements, expectedMessage) {
  const requirementsPath = writeRichRequirements(baseDir, requirements);
  const outPath = path.join(baseDir, `${featureId}.json`);
  const result = runNode([
    'tools/prd-builder/create-prd.mjs',
    '--feature-id', featureId,
    '--name', 'Invalid Requirements',
    '--summary', '验证 requirements 必填字段校验',
    '--project', projectPath,
    '--requirements-file', requirementsPath,
    '--out', outPath,
    '--force',
  ], { expectFailure: true });
  assert(result.stderr.includes(expectedMessage), `requirements 缺失必填字段时错误应包含：${expectedMessage}`);
  assert(!fs.existsSync(outPath), 'requirements 校验失败时不应写出 PRD');
}

function assertInvalidPrdSchema(baseDir) {
  const outPath = path.join(baseDir, 'invalid-schema-prd.json');
  const result = runNode([
    'tools/prd-builder/create-prd.mjs',
    '--feature-id', 'invalid-schema-prd',
    '--prd-id', 'bad-prd-id',
    '--name', 'Invalid Schema PRD',
    '--summary', '验证 PRD Builder 落盘前 schema 校验',
    '--project', projectPath,
    '--bases', 'backend',
    '--out', outPath,
    '--force',
  ], { expectFailure: true });
  assert(result.stderr.includes('PRD schema validation failed'), 'PRD schema 校验失败时应输出统一错误前缀');
  assert(result.stderr.includes('$.prdId'), 'PRD schema 校验失败时应包含具体 JSON path');
  assert(result.stderr.includes('字段值不符合格式'), 'PRD schema 校验失败时应包含具体错误信息');
  assert(!fs.existsSync(outPath), 'PRD schema 校验失败时不应写出坏 PRD');
}

function testPrdBuilderRequirementsFile(baseDir) {
  const requirementsPath = writeRichRequirements(baseDir);
  const prdPath = createPrdFromRequirements(baseDir, 'requirements-rich-prd', requirementsPath);
  const prd = readJson(prdPath);
  assert(prd.status === 'draft' && prd.humanApproval.approved === false, 'requirements-file 生成 PRD 仍应是 draft');
  assert(prd.impactedBaseIds.join(',') === 'client,backend,middle', 'requirements-file 应填充 impactedBaseIds');
  assert(prd.personas.length === 2, 'requirements-file 应填充 personas');
  assert(prd.personas[0].id === 'admin-user' && prd.personas[0].name === '后台管理员', 'personas 应保留输入 ID 和内容');
  assert(prd.personas[1].id === 'persona-2' && prd.personas[1].name === '业务用户', 'personas 缺 ID 时应自动补齐稳定 ID');
  assert(prd.userStories.map((story) => story.id).join(',') === 'US-001,US-002', 'userStories 应自动补齐稳定 ID');
  assert(prd.userStories[0].acceptanceCriteria[0].id === 'AC-001', 'acceptanceCriteria 应自动补齐稳定 ID');
  assert(prd.businessRules[0].id === 'BR-001', 'businessRules 应自动补齐稳定 ID');
  assert(prd.dataEntities[0].id === 'DE-001', 'dataEntities 应自动补齐稳定 ID');
  assert(prd.permissions[0].id === 'PERM-001' && prd.permissions[0].targetBaseId === 'backend', 'permissions 应补齐 ID 并保留 targetBaseId');
  assert(prd.assumptions[0].id === 'ASM-001', 'assumptions 应自动补齐稳定 ID');
  assert(prd.openQuestions[0].id === 'Q-001', 'openQuestions 应自动补齐稳定 ID');
  assert(prd.risks[0].id === 'RISK-001', 'risks 应自动补齐稳定 ID');
  assert(prd.constraints.security.some((item) => item.includes('权限码')), 'requirements constraints.security 应写入 PRD');
  assert(prd.constraints.ux.some((item) => item.includes('表格表单')), 'requirements constraints.ux 应写入 PRD');
  assert(prd.constraints.performance.some((item) => item.includes('分页')), 'requirements constraints.performance 应写入 PRD');
  assert(prd.constraints.quality.some((item) => item.includes('401/403/404')), 'requirements constraints.quality 应写入 PRD');

  const refused = runNode(['tools/prd-builder/approve-prd.mjs', '--prd', prdPath, '--by', 'e2e'], { expectFailure: true });
  assert(refused.stderr.includes('PRD 存在未关闭 openQuestions'), 'openQuestions 未关闭时默认拒绝确认');
  parseCommandJson(runNode(['tools/prd-builder/approve-prd.mjs', '--prd', prdPath, '--by', 'e2e', '--allow-open-questions']));
  assert(readJson(prdPath).status === 'approved', '--allow-open-questions 应允许确认 PRD');

  const invalidRequirements = writeRichRequirements(baseDir, {
    permissions: [
      {
        code: 'system:noticeTag:list',
        name: '公告标签查询',
        targetBaseId: 'missing',
      },
    ],
  });
  const invalid = runNode([
    'tools/prd-builder/create-prd.mjs',
    '--feature-id', 'requirements-invalid-permission',
    '--name', 'Invalid Permission',
    '--summary', '验证权限目标基座校验',
    '--project', projectPath,
    '--requirements-file', invalidRequirements,
    '--out', path.join(baseDir, 'invalid-permission-prd.json'),
    '--force',
  ], { expectFailure: true });
  assert(invalid.stderr.includes('targetBaseId=missing'), 'permission.targetBaseId 不存在时应失败');

  assertInvalidRequirements(baseDir, 'requirements-missing-story', {
    userStories: [
      {
        title: '缺少正文',
        acceptanceCriteria: ['应失败。'],
        priority: 'must',
      },
    ],
  }, 'userStories[1].story 必须是非空字符串');
  assertInvalidRequirements(baseDir, 'requirements-missing-field-type', {
    dataEntities: [
      {
        name: '公告标签',
        description: '用于标记公告类型。',
        fields: [{ name: 'tagName', required: true, description: '标签名称' }],
      },
    ],
  }, 'dataEntities[1].fields[1].type 必须是非空字符串');
  assertInvalidRequirements(baseDir, 'requirements-missing-permission-code', {
    permissions: [
      {
        name: '公告标签查询',
        targetBaseId: 'backend',
      },
    ],
  }, 'permissions[1].code 必须是非空字符串');
  assertInvalidRequirements(baseDir, 'requirements-missing-persona-name', {
    personas: [
      {
        id: 'broken-persona',
        description: '缺少 name 的 persona。',
      },
    ],
  }, 'personas[1].name 必须是非空字符串');
  assertInvalidRequirements(baseDir, 'requirements-invalid-persona-name', {
    personas: [
      {
        id: 'broken-persona',
        name: 123,
        description: 'name 类型错误的 persona。',
      },
    ],
  }, 'personas[1].name 必须是非空字符串');
  assertInvalidPrdSchema(baseDir);
}

function testTaskPlannerRichPrdDependencies(baseDir) {
  const requirementsPath = writeRichRequirements(baseDir, {
    openQuestions: [
      {
        question: '公告标签是否需要导出？',
        status: 'answered',
        answer: '一期不需要导出。',
      },
    ],
  });
  const prdPath = createPrdFromRequirements(baseDir, 'requirements-task-plan', requirementsPath);
  parseCommandJson(runNode(['tools/prd-builder/approve-prd.mjs', '--prd', prdPath, '--by', 'e2e']));
  const taskPlanPath = path.join(baseDir, 'requirements-task-plan.json');
  const runStatePath = path.join(baseDir, 'requirements-run-state.json');
  parseCommandJson(runNode([
    'tools/task-planner/create-task-plan.mjs',
    '--project', projectPath,
    '--prd', prdPath,
    '--out', taskPlanPath,
    '--run-state-out', runStatePath,
    '--force',
  ]));
  parseCommandJson(runNode([
    'tools/task-planner/approve-task-plan.mjs',
    '--project', projectPath,
    '--prd', prdPath,
    '--task-plan', taskPlanPath,
    '--run-state', runStatePath,
    '--by', 'e2e',
  ]));
  const taskPlan = readJson(taskPlanPath);
  const runState = readJson(runStatePath);
  const validation = validateFiles({
    project: projectPath,
    prd: prdPath,
    'task-plan': taskPlanPath,
    'run-state': runStatePath,
    'templates-dir': templatesDir,
  });
  assert(validation.valid, `rich PRD 生成的 task-plan/run-state 应通过 Validator：${JSON.stringify(validation, null, 2)}`);
  const firstStoryTasks = taskPlan.storyGroups[0].tasks;
  const secondStoryTasks = taskPlan.storyGroups[1].tasks;
  assert(firstStoryTasks.map((task) => task.type).join(',') === 'schema,backend,middle,client', 'dataEntities 应触发后端 schema task 且保持 backend->middle->client 排序');
  assert(firstStoryTasks[0].requiredSkillId === 'ruoyi-database-migration', 'schema task 应使用 database migration skill');
  assert(firstStoryTasks[1].dependsOn.join(',') === firstStoryTasks[0].id, 'backend task 应依赖 schema task');
  assert(secondStoryTasks[0].dependsOn.includes(firstStoryTasks.at(-1).id), 'story.dependencies 应让后续故事入口任务依赖前置故事终止任务');
  assert(secondStoryTasks[1].dependsOn.includes(secondStoryTasks[0].id), '后续故事 backend task 应继续依赖本故事 schema task');
  assert(runState.taskStates[firstStoryTasks[0].id].status === 'ready', '无前置依赖的首个 schema task 应 ready');
  assert(runState.taskStates[secondStoryTasks[0].id].status === 'pending', '跨 story 依赖的 schema task 应 pending');
  assert(firstStoryTasks[0].scope.inScope.some((item) => item.includes('公告标签名称')), 'businessRules 应进入 task scope');
  assert(firstStoryTasks[0].scope.inScope.some((item) => item.includes('公告标签') && item.includes('tagName')), 'dataEntities 应进入 task scope');
  assert(firstStoryTasks[0].scope.inScope.some((item) => item.includes('system:noticeTag:list')), 'permissions 应进入 task scope');
  assert(firstStoryTasks[0].humanNotes.includes('一期只支持后台维护公告标签'), 'assumptions 应进入 humanNotes');
  assert(firstStoryTasks[0].humanNotes.includes('公告标签是否需要导出'), 'openQuestions 应进入 humanNotes');
  assert(firstStoryTasks[0].humanNotes.includes('历史公告数据可能缺少标签'), 'risks 应进入 humanNotes');

  const invalidDependencyRequirements = writeRichRequirements(baseDir, {
    userStories: [
      {
        title: '依赖错误故事',
        story: '作为管理员，我希望看到明确的依赖错误。',
        acceptanceCriteria: ['依赖错误应被拒绝。'],
        priority: 'must',
        dependencies: ['US-999'],
      },
    ],
    openQuestions: [],
  });
  const invalidPrdPath = createPrdFromRequirements(baseDir, 'requirements-invalid-dependency', invalidDependencyRequirements);
  parseCommandJson(runNode(['tools/prd-builder/approve-prd.mjs', '--prd', invalidPrdPath, '--by', 'e2e']));
  const invalid = runNode([
    'tools/task-planner/create-task-plan.mjs',
    '--project', projectPath,
    '--prd', invalidPrdPath,
    '--out', path.join(baseDir, 'invalid-dependency-task-plan.json'),
    '--run-state-out', path.join(baseDir, 'invalid-dependency-run-state.json'),
    '--force',
  ], { expectFailure: true });
  assert(invalid.stderr.includes('依赖不存在的 storyId：US-999'), 'story.dependencies 引用不存在故事时应失败');
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
  assert(/^[a-f0-9]{64}$/.test(taskContext.skill.documentSha256), 'taskContext 应记录 skill 文档 sha256');
  const taskRun = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'task-run.json'));
  const attempt = taskRun.attempts[0];
  assert(attempt.skillContext.enforced === true, 'task-run 应记录 skillContext.enforced=true');
  assert(attempt.skillContext.skillId === 'ruoyi-module-crud', 'task-run 应记录实际执行 skillId');
  assert(attempt.skillContext.skillDocumentPath === taskContext.skill.documentPath, 'task-run 应记录实际 skill 文档路径');
  assert(attempt.skillContext.skillDocumentSha256 === taskContext.skill.documentSha256, 'task-run 应记录实际 skill 文档 hash');
  assert(attempt.promptInputs.some((input) => input.type === 'skill' && input.path.endsWith('/skills/ruoyi-module-crud.md')), 'promptInputs 应指向实际 skill 文档');
  assert(attempt.promptInputs.some((input) => input.type === 'skillContext' && input.path.endsWith('/runs/TASK-001/task-context.json')), 'promptInputs 应指向 task-context');
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

function writeHttpFixtureServer(baseDir) {
  const serverPath = path.join(baseDir, 'http-fixture-server.mjs');
  fs.writeFileSync(serverPath, `#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
const portFile = process.argv[2];
const orderFile = process.argv[3];
function writeJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}
function appendOrder(label) {
  fs.appendFileSync(orderFile, label + '\\n', 'utf8');
}
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const auth = request.headers.authorization || '';
  if (url.pathname === '/anonymous') return writeJson(response, 401, { error: 'unauthorized' });
  if (url.pathname === '/private') {
    if (auth === 'Bearer good-token') return writeJson(response, 200, { ok: true, user: { id: 123, role: 'admin' }, message: 'welcome alpha' });
    if (!auth) return writeJson(response, 401, { error: 'missing token' });
    return writeJson(response, 403, { error: 'forbidden' });
  }
  if (url.pathname === '/echo-auth') return writeJson(response, 500, { echoedAuth: auth });
  if (url.pathname === '/body') return writeJson(response, 200, { ok: true, nested: { value: 'yes' }, message: 'hello checks runner' });
  if (url.pathname === '/text') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    return response.end('plain text response');
  }
  if (url.pathname === '/long') {
    response.writeHead(500, { 'content-type': 'text/plain' });
    return response.end('x'.repeat(1200));
  }
  if (url.pathname === '/auth-disabled') {
    appendOrder('request');
    return writeJson(response, 200, { ok: true });
  }
  return writeJson(response, 404, { error: 'missing' });
});
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(portFile, String(server.address().port), 'utf8');
});
`, 'utf8');
  return serverPath;
}

function waitForFile(filePath, timeoutMs = 5000) {
  const startedAt = Date.now();
  const lock = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(filePath)) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`等待文件超时：${filePath}`);
    Atomics.wait(lock, 0, 0, 10);
  }
}

function withHttpFixtureServer(baseDir, fn) {
  const serverPath = writeHttpFixtureServer(baseDir);
  const portFile = path.join(baseDir, `http-fixture-port-${Date.now()}.txt`);
  const orderFile = path.join(baseDir, `http-fixture-order-${Date.now()}.txt`);
  fs.writeFileSync(orderFile, '', 'utf8');
  const child = spawn(process.execPath, [serverPath, portFile, orderFile], {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    waitForFile(portFile);
    const port = fs.readFileSync(portFile, 'utf8').trim();
    return fn(`http://127.0.0.1:${port}`, orderFile);
  } finally {
    child.kill();
  }
}

function runOneHttpCheck(http, options = {}) {
  const result = runChecks({
    id: 'TASK-HTTP',
    checks: [
      {
        id: options.id ?? 'http-check',
        name: options.name ?? 'HTTP check',
        type: 'http',
        required: true,
        http,
      },
    ],
  }, {
    mode: options.mode ?? 'real',
    cwd: options.cwd ?? repoRoot,
    timeoutMs: options.timeoutMs ?? 10000,
  });
  return { result, check: result.checks[0] };
}

function withEnv(name, value, fn) {
  const before = process.env[name];
  if (value === null) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  }
}

function testChecksRunnerHttpAnonymous401(baseDir) {
  withHttpFixtureServer(baseDir, (baseUrl) => {
    const { result, check } = runOneHttpCheck({
      method: 'GET',
      url: `${baseUrl}/anonymous`,
      expectedStatus: 401,
      authMode: 'anonymous',
    });
    assert(result.status === 'passed' && check.status === 'passed', 'anonymous 401 应通过 expectedStatus');
  });
}

function testChecksRunnerHttpAuthenticatedToken(baseDir) {
  withHttpFixtureServer(baseDir, (baseUrl) => withEnv('ENGINE_E2E_TOKEN', 'good-token', () => {
    const { result, check } = runOneHttpCheck({
      method: 'GET',
      url: `${baseUrl}/private`,
      expectedStatus: 200,
      authMode: 'authenticated',
      tokenEnv: 'ENGINE_E2E_TOKEN',
    });
    assert(result.status === 'passed' && check.status === 'passed', 'authenticated token 应注入并通过 200');
  }));
}

function testChecksRunnerHttpAuthenticatedMissingToken(baseDir) {
  withHttpFixtureServer(baseDir, (baseUrl) => withEnv('ENGINE_E2E_TOKEN', null, () => {
    const { result, check } = runOneHttpCheck({
      method: 'GET',
      url: `${baseUrl}/private`,
      expectedStatus: 200,
      authMode: 'authenticated',
      tokenEnv: 'ENGINE_E2E_TOKEN',
    });
    assert(result.status === 'checks_failed' && check.status === 'failed', '缺 token env 应失败');
    assert(check.summary.includes('ENGINE_E2E_TOKEN') && !check.summary.includes('good-token'), '缺 token summary 不应泄露 token');
  }));
}

function testChecksRunnerHttpMockModeDoesNotRequireToken() {
  withEnv('ENGINE_E2E_TOKEN', null, () => {
    const { result, check } = runOneHttpCheck({
      method: 'GET',
      url: 'http://127.0.0.1:1/private',
      expectedStatus: 200,
      authMode: 'authenticated',
      tokenEnv: 'ENGINE_E2E_TOKEN',
    }, { mode: 'mock' });
    assert(result.status === 'passed' && check.status === 'passed', 'mock mode 不应真实发 HTTP 或要求 token');
  });
}

function testChecksRunnerHttpForbiddenExpected(baseDir) {
  withHttpFixtureServer(baseDir, (baseUrl) => withEnv('ENGINE_E2E_TOKEN', 'bad-token', () => {
    const { result, check } = runOneHttpCheck({
      method: 'GET',
      url: `${baseUrl}/private`,
      expectedStatus: 403,
      authMode: 'authenticated',
      tokenEnv: 'ENGINE_E2E_TOKEN',
    });
    assert(result.status === 'passed' && check.status === 'passed', 'bad token 403 可通过 expectedStatus 表达');
  }));
}

function testChecksRunnerHttpMissingEndpoint404(baseDir) {
  withHttpFixtureServer(baseDir, (baseUrl) => {
    const { result, check } = runOneHttpCheck({
      method: 'GET',
      url: `${baseUrl}/missing`,
      expectedStatus: 404,
      authMode: 'anonymous',
    });
    assert(result.status === 'passed' && check.status === 'passed', 'missing endpoint 404 可通过 expectedStatus 表达');
  });
}

function testChecksRunnerHttpStatusMismatchTruncatesBody(baseDir) {
  withHttpFixtureServer(baseDir, (baseUrl) => {
    const { result, check } = runOneHttpCheck({
      method: 'GET',
      url: `${baseUrl}/long`,
      expectedStatus: 200,
    });
    assert(result.status === 'checks_failed' && check.status === 'failed', '状态码 mismatch 应失败');
    assert(check.summary.includes('HTTP 500 expected 200'), 'mismatch summary 应包含状态码');
    assert(check.summary.includes('<truncated>') && check.summary.length < 450, 'mismatch body 应截断');
  });
}

function testChecksRunnerHttpRedactsEchoedToken(baseDir) {
  withHttpFixtureServer(baseDir, (baseUrl) => withEnv('ENGINE_E2E_TOKEN', 'super-secret-token-for-review', () => {
    const { result, check } = runOneHttpCheck({
      method: 'GET',
      url: `${baseUrl}/echo-auth`,
      expectedStatus: 200,
      authMode: 'authenticated',
      tokenEnv: 'ENGINE_E2E_TOKEN',
    });
    assert(result.status === 'checks_failed' && check.status === 'failed', '回显 token 的失败响应仍应失败');
    assert(!check.summary.includes('super-secret-token-for-review'), 'summary 不应泄露 token 原文');
    assert(!check.summary.includes('Bearer super-secret-token-for-review'), 'summary 不应泄露 Authorization 原文');
    assert(check.summary.includes('[REDACTED]'), 'summary 应包含脱敏标记');
  }));
}

function testChecksRunnerHttpExpectedBodyPassFail(baseDir) {
  withHttpFixtureServer(baseDir, (baseUrl) => {
    const pass = runOneHttpCheck({
      method: 'GET',
      url: `${baseUrl}/body`,
      expectedStatus: 200,
      expectedBody: {
        contains: ['hello', 'checks runner'],
        notContains: 'password',
        jsonFields: {
          ok: true,
          'nested.value': 'yes',
        },
      },
    });
    assert(pass.result.status === 'passed' && pass.check.status === 'passed', 'contains/notContains/jsonFields 命中时应通过');

    const fail = runOneHttpCheck({
      method: 'GET',
      url: `${baseUrl}/body`,
      expectedStatus: 200,
      expectedBody: {
        contains: 'missing-fragment',
        notContains: 'hello',
        jsonFields: {
          'nested.value': 'no',
        },
      },
    });
    assert(fail.result.status === 'checks_failed' && fail.check.status === 'failed', 'body assertion 不命中时应失败');
    assert(fail.check.summary.includes('does not contain') && fail.check.summary.includes('contains forbidden') && fail.check.summary.includes('jsonFields nested.value'), 'body assertion 失败应说明原因');
  });
}

function testChecksRunnerHttpJsonFieldsNonJsonFails(baseDir) {
  withHttpFixtureServer(baseDir, (baseUrl) => {
    const { result, check } = runOneHttpCheck({
      method: 'GET',
      url: `${baseUrl}/text`,
      expectedStatus: 200,
      expectedBody: {
        jsonFields: { ok: true },
      },
    });
    assert(result.status === 'checks_failed' && check.status === 'failed', '非 JSON 响应做 jsonFields 应失败');
    assert(check.summary.includes('not valid JSON'), '非 JSON jsonFields 失败应说明 JSON 解析问题');
  });
}

function testChecksRunnerHttpAuthDisabledOrder(baseDir) {
  withHttpFixtureServer(baseDir, (baseUrl, orderFile) => {
    const { result, check } = runOneHttpCheck({
      method: 'GET',
      url: `${baseUrl}/auth-disabled`,
      expectedStatus: 200,
      authMode: 'auth_disabled',
      environment: 'test',
      setupCommands: [`printf "setup\\n" >> ${orderFile}`],
      teardownCommands: [`printf "teardown\\n" >> ${orderFile}`],
    });
    assert(result.status === 'passed' && check.status === 'passed', 'auth_disabled test 环境应可执行');
    assert(fs.readFileSync(orderFile, 'utf8').trim().split('\n').join(',') === 'setup,request,teardown', 'auth_disabled 应按 setup/request/teardown 顺序执行');
  });
}

function testChecksRunnerHttpAuthDisabledProductionRejected(baseDir) {
  withHttpFixtureServer(baseDir, (baseUrl, orderFile) => {
    const { result, check } = runOneHttpCheck({
      method: 'GET',
      url: `${baseUrl}/auth-disabled`,
      expectedStatus: 200,
      authMode: 'auth_disabled',
      environment: 'production',
      setupCommands: [`printf "setup\\n" >> ${orderFile}`],
      teardownCommands: [`printf "teardown\\n" >> ${orderFile}`],
    });
    assert(result.status === 'checks_failed' && check.status === 'failed', 'auth_disabled production 应被拒绝');
    assert(check.summary.includes('only allowed in dev/test'), 'production 拒绝 summary 应明确环境限制');
    assert(fs.readFileSync(orderFile, 'utf8') === '', 'production 拒绝不应执行 setup/request/teardown');
  });
}

function testChecksRunnerHttpRequestFailureStillTeardown(baseDir) {
  const orderFile = path.join(baseDir, 'request-failure-teardown-order.txt');
  fs.writeFileSync(orderFile, '', 'utf8');
  const { result, check } = runOneHttpCheck({
    method: 'GET',
    url: 'http://127.0.0.1:1/unreachable',
    expectedStatus: 200,
    authMode: 'auth_disabled',
    environment: 'dev',
    setupCommands: [`printf "setup\\n" >> ${orderFile}`],
    teardownCommands: [`printf "teardown\\n" >> ${orderFile}`],
  }, { timeoutMs: 1000 });
  assert(result.status === 'checks_failed' && check.status === 'failed', 'request 失败应让 check failed');
  assert(fs.readFileSync(orderFile, 'utf8').trim().split('\n').join(',') === 'setup,teardown', 'request 失败也应执行 teardown');
}

function testChecksRunnerHttpTeardownFailure(baseDir) {
  withHttpFixtureServer(baseDir, (baseUrl) => {
    const { result, check } = runOneHttpCheck({
      method: 'GET',
      url: `${baseUrl}/auth-disabled`,
      expectedStatus: 200,
      authMode: 'auth_disabled',
      environment: 'dev',
      setupCommands: [],
      teardownCommands: [`${process.execPath} -e "process.exit(9)"`],
    });
    assert(result.status === 'checks_failed' && check.status === 'failed', 'teardown 失败应让 check failed');
    assert(check.summary.includes('teardown') && check.summary.includes('requires human'), 'teardown 失败 summary 应提示 requires human');
  });
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
  const probePath = path.join(baseDir, 'shell-skill-probe.mjs');
  fs.writeFileSync(probePath, [
    "import fs from 'node:fs';",
    "const contextPath = process.env.ENGINE_TASK_CONTEXT_PATH;",
    "const skillPath = process.env.ENGINE_SKILL_DOCUMENT_PATH;",
    "const skillHash = process.env.ENGINE_SKILL_DOCUMENT_SHA256;",
    "const skillId = process.env.ENGINE_REQUIRED_SKILL_ID;",
    "if (!contextPath || !fs.existsSync(contextPath)) throw new Error('missing ENGINE_TASK_CONTEXT_PATH');",
    "if (!skillPath || !fs.existsSync(skillPath)) throw new Error('missing ENGINE_SKILL_DOCUMENT_PATH');",
    "const context = JSON.parse(fs.readFileSync(contextPath, 'utf8'));",
    "if (skillId !== context.task.requiredSkillId) throw new Error('skill id mismatch');",
    "if (skillPath !== context.skill.documentPath) throw new Error('skill document path mismatch');",
    "if (skillHash !== context.skill.documentSha256) throw new Error('skill hash mismatch');",
    "if (!context.skill.document.includes('# Skill:')) throw new Error('missing skill document body');",
    "console.log('shell-ok skill-context-read');",
  ].join('\n'));
  const result = runLoop(paths, [
    '--agent-adapter', 'shell',
    '--shell-command', `${process.execPath} ${probePath}`,
  ]);
  assert(result.summary.taskSummary.done.includes('TASK-001'), 'shell adapter 成功时任务应 done');
  const taskRun = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'task-run.json'));
  assert(taskRun.attempts[0].agent.tool === 'shell', 'task-run 应记录 shell agent');
  assert(taskRun.attempts[0].summary.includes('shell-ok skill-context-read'), 'shell adapter 应能读取 skill context');
  assert(taskRun.attempts[0].skillContext.enforced === true, 'shell task-run 应记录 skillContext enforced');
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
  assert(availableAgentAdapters().includes('external'), 'availableAgentAdapters 应包含 external');
}

function testExternalAgentAdapterAllowedPathPass(baseDir) {
  const fakeAgent = writeFakeCodex(baseDir);
  const paths = prepareGitDiffFeature(baseDir, 'external-agent-allowed-path', { 'src/pages/notice/index.vue': 'before\n' });
  setFirstTaskAllowedPaths(paths, ['src/pages/notice/**']);
  const result = runLoop(paths, [
    '--agent-adapter', 'external',
    '--external-agent-command', fakeAgent,
    '--external-agent-extra-arg', 'exec',
    '--external-agent-extra-arg', '--fake-mode',
    '--external-agent-extra-arg', 'write-allowed',
    '--max-tasks', '1',
  ]);
  assert(result.summary.taskSummary.done.includes('TASK-001'), 'external agent 修改允许路径时任务应 done');
  assert(firstAttemptChangedFiles(paths).join(',') === 'src/pages/notice/index.vue', 'external agent 修改应由 git diff 写入 changedFiles');
  const taskRun = readJson(path.join(paths.dir, 'runs', 'TASK-001', 'task-run.json'));
  assert(taskRun.attempts[0].agent.tool === 'external-agent', 'task-run 应记录 external-agent');
  const review = firstReview(paths);
  assert(review.verdict === 'pass', 'external agent 修改允许路径时 review 应 pass');
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
  ['Skill task type 匹配校验', testSkillTaskTypeMismatch],
  ['PRD Builder requirements-file', testPrdBuilderRequirementsFile],
  ['Task Planner rich PRD dependencies', testTaskPlannerRichPrdDependencies],
  ['跨端契约校验', testContractsValidator],
  ['跨端契约 cwd 路径解析', testContractsValidatorCwd],
  ['Base Bootstrap ready/partial 判断', testBaseBootstrapReadyAndPartial],
  ['Real Project Runner source-template', testRealProjectRunnerSourceTemplate],
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
  ['Checks Runner HTTP anonymous 401', testChecksRunnerHttpAnonymous401],
  ['Checks Runner HTTP authenticated token', testChecksRunnerHttpAuthenticatedToken],
  ['Checks Runner HTTP authenticated 缺 token', testChecksRunnerHttpAuthenticatedMissingToken],
  ['Checks Runner HTTP mock 不要求 token', testChecksRunnerHttpMockModeDoesNotRequireToken],
  ['Checks Runner HTTP 403 expected', testChecksRunnerHttpForbiddenExpected],
  ['Checks Runner HTTP 404 expected', testChecksRunnerHttpMissingEndpoint404],
  ['Checks Runner HTTP mismatch body 截断', testChecksRunnerHttpStatusMismatchTruncatesBody],
  ['Checks Runner HTTP token 脱敏', testChecksRunnerHttpRedactsEchoedToken],
  ['Checks Runner HTTP expectedBody', testChecksRunnerHttpExpectedBodyPassFail],
  ['Checks Runner HTTP 非 JSON jsonFields', testChecksRunnerHttpJsonFieldsNonJsonFails],
  ['Checks Runner HTTP auth_disabled 顺序', testChecksRunnerHttpAuthDisabledOrder],
  ['Checks Runner HTTP auth_disabled production 拒绝', testChecksRunnerHttpAuthDisabledProductionRejected],
  ['Checks Runner HTTP request 失败仍 teardown', testChecksRunnerHttpRequestFailureStillTeardown],
  ['Checks Runner HTTP teardown 失败', testChecksRunnerHttpTeardownFailure],
  ['Review Runner allowedPaths 全命中', testReviewAllowedPathsPass],
  ['Review Runner allowedPaths 越界失败', testReviewAllowedPathsFail],
  ['Review Runner allowedPaths 目录边界', testReviewAllowedPathsGlobBoundary],
  ['Review Runner allowedPaths 部分越界', testReviewAllowedPathsPartialFail],
  ['Review Runner changedFiles 为空不失败', testReviewAllowedPathsEmptyChangedFiles],
  ['Agent Adapter 列表包含 codex', testAvailableAgentAdaptersIncludesCodex],
  ['Shell Adapter 成功执行', testShellAdapterSuccess],
  ['External Agent Adapter fake 修改允许路径', testExternalAgentAdapterAllowedPathPass],
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
