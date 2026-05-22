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

const smokeScenarioIds = [
  'client-announcement-tags',
  'backend-sql-migration-smoke',
  'middle-notice-page-smoke',
];

export { scenarios, smokeScenarioIds };
