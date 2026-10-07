import { createInitialState } from '../src/services/mockData'
import { createRequest } from '../src/services/requestService'
import {
  decideReceiptItem,
  importReceiptBatch,
  receiptsForRequest,
  retryReceiptBatch,
} from '../src/services/receiptService'
import type { WorkspaceState } from '../src/lib/schemas'

let failures = 0
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  PASS ${name}`)
  } else {
    failures += 1
    console.error(`  FAIL ${name} ${detail}`)
  }
}

const lines = [
  {
    requestCode: 'DSR-2026-001',
    systemName: '客户关系管理系统',
    executedAt: '2026-10-02T09:00:00Z',
    outcome: 'completed' as const,
    resultSummary: '客户主档访问已完成',
    receiptRef: 'RC-1',
  },
  {
    requestCode: 'DSR-2026-001',
    systemName: '订单与交易平台',
    executedAt: '2026-10-02T10:30:00Z',
    outcome: 'partial' as const,
    resultSummary: '仅完成近 12 个月订单',
    receiptRef: 'RC-2',
  },
  {
    requestCode: 'DSR-2026-001',
    systemName: '客服工单系统',
    executedAt: '2026-10-03T03:20:00Z',
    outcome: 'failed' as const,
    resultSummary: '附件区维护无法导出',
    receiptRef: 'RC-3',
  },
]

// 1. 首次导入：完成 / 部分 / 失败
let state: WorkspaceState = createInitialState()
state = importReceiptBatch(
  state,
  {
    clientToken: 'window-A',
    externalBatchId: 'B1',
    partnerName: '合作方离线通道',
    receivedAt: '2026-10-07T01:00:00Z',
    lines,
  },
  '客服专员',
)
let batch = state.receiptBatches.find((b) => b.externalBatchId === 'B1')!
const req1 = state.requests.find((r) => r.code === 'DSR-2026-001')!
check('批次状态 applied', batch.status === 'applied', batch.status)
check('批次 3 行均 applied', batch.items.every((i) => i.status === 'applied'))
check('完成行任务 completed', req1.tasks.find((t) => t.id === 'req-001-execute-sys-crm')?.status === 'completed')
check('失败行任务 blocked', req1.tasks.find((t) => t.id === 'req-001-execute-sys-support')?.status === 'blocked')
check('部分执行任务 active', req1.tasks.find((t) => t.id === 'req-001-execute-sys-order')?.status === 'active')
check('请求进入复核', req1.status === 'review-required', req1.status)
check('证据恰好 3 条回执 + 原 1 条', req1.evidence.length === 4, String(req1.evidence.length))
check('回执证据有来源标记', req1.evidence.some((e) => e.source === 'partner-receipt'))
const auditAfterFirst = state.audit.length
const reqAuditAfterFirst = req1.audit.length

// 2. 同一窗口再次导入完全相同批次：沿用原结果
state = importReceiptBatch(
  state,
  {
    clientToken: 'window-A',
    externalBatchId: 'B1',
    partnerName: '合作方离线通道',
    receivedAt: '2026-10-07T01:00:00Z',
    lines,
  },
  '客服专员',
)
check('批次数量不增加', state.receiptBatches.length === 1)
batch = state.receiptBatches.find((b) => b.externalBatchId === 'B1')!
check('记录 reimport', (batch.reimports?.length ?? 0) === 1)
check('证据不重复生成', state.requests.find((r) => r.code === 'DSR-2026-001')!.evidence.length === 4)
check('全局审计不重复生成', state.audit.length === auditAfterFirst)
check(
  '请求审计不重复生成',
  state.requests.find((r) => r.code === 'DSR-2026-001')!.audit.length === reqAuditAfterFirst,
)

// 3. 另一窗口并发提交同批次：后到者整批复核
state = importReceiptBatch(
  state,
  {
    clientToken: 'window-B',
    externalBatchId: 'B1',
    partnerName: '合作方离线通道',
    receivedAt: '2026-10-07T01:05:00Z',
    lines,
  },
  '客服专员',
)
check('产生第二批次（并发）', state.receiptBatches.length === 2)
const concurrent = state.receiptBatches.find((b) => b.clientToken === 'window-B')!
check('并发批次 review-required', concurrent.status === 'review-required', concurrent.status)
check('并发行全部 review-concurrent', concurrent.items.every((i) => i.status === 'review-concurrent'))
check('并发批次不改证据数', state.requests.find((r) => r.code === 'DSR-2026-001')!.evidence.length === 4)
check('并发行已绑定任务', Boolean(concurrent.items[0].taskId))

// 并发批次首行人工采用：可写入且旧证据标记替代
const concurrentEvidenceBefore = state.requests.find((r) => r.code === 'DSR-2026-001')!.evidence.length
state = decideReceiptItem(state, concurrent.id, concurrent.items[0].id, 'adopt-receipt', '两窗口核对后采用后到回执', '隐私负责人')
const concurrentReq = state.requests.find((r) => r.code === 'DSR-2026-001')!
check('并发采用新增证据', concurrentReq.evidence.length === concurrentEvidenceBefore + 1)
check('并发采用标记旧证据替代', concurrentReq.evidence.some((e) => e.superseded))

// 4. 差异：已完成任务收到新结论
state = importReceiptBatch(
  state,
  {
    clientToken: 'window-A',
    externalBatchId: 'B2',
    partnerName: '合作方离线通道',
    receivedAt: '2026-10-07T02:00:00Z',
    lines: [
      {
        requestCode: 'DSR-2026-004',
        systemName: '营销自动化平台',
        executedAt: '2026-10-05T08:00:00Z',
        outcome: 'completed',
        resultSummary: '新回执称同意撤回范围与旧记录不同',
        receiptRef: 'RC-9',
      },
    ],
  },
  '客服专员',
)
const diffBatch = state.receiptBatches.find((b) => b.externalBatchId === 'B2')!
check('差异批次待复核', diffBatch.status === 'review-required')
check('差异行 review-diff', diffBatch.items[0].status === 'review-diff')
check('列出至少一项差异', diffBatch.items[0].diffs.length >= 1, String(diffBatch.items[0].diffs.length))
const req4EvidenceBefore = state.requests.find((r) => r.code === 'DSR-2026-004')!.evidence.length

// 人工选择保留旧记录
state = decideReceiptItem(state, diffBatch.id, diffBatch.items[0].id, 'keep-existing', '以既有签署记录为准', '隐私负责人')
check('保留后批次 applied', state.receiptBatches.find((b) => b.externalBatchId === 'B2')!.status === 'applied')
check('保留旧记录不新增证据', state.requests.find((r) => r.code === 'DSR-2026-004')!.evidence.length === req4EvidenceBefore)

// 再来一条差异，这次人工采用新回执
state = importReceiptBatch(
  state,
  {
    clientToken: 'window-A',
    externalBatchId: 'B3',
    partnerName: '合作方离线通道',
    receivedAt: '2026-10-07T03:00:00Z',
    lines: [
      {
        requestCode: 'DSR-2026-004',
        systemName: '营销自动化平台',
        executedAt: '2026-10-06T08:00:00Z',
        outcome: 'partial',
        resultSummary: '新回执：仅停止推送，短信通道仍在',
        receiptRef: 'RC-10',
      },
    ],
  },
  '客服专员',
)
const adoptBatch = state.receiptBatches.find((b) => b.externalBatchId === 'B3')!
check('B3 差异复核', adoptBatch.items[0].status === 'review-diff')
const req4 = state.requests.find((r) => r.code === 'DSR-2026-004')!
state = decideReceiptItem(state, adoptBatch.id, adoptBatch.items[0].id, 'adopt-receipt', '核实后以新回执为准', '隐私负责人')
const req4After = state.requests.find((r) => r.code === 'DSR-2026-004')!
check('采用后新增一条证据', req4After.evidence.length === req4.evidence.length + 1)
check('旧回执证据被标记替代（不删除）', req4After.evidence.some((e) => e.superseded === true))
check('任务按部分执行进入复核', req4After.status === 'review-required')

// 5. 写入失败与断点恢复：最小工作区，1 请求 × 5 系统的待执行任务
function buildResumeState(): WorkspaceState {
  let custom = createRequest(
    createInitialState(),
    {
      requesterName: '断点测试人',
      requesterContact: 'resume@example.com',
      region: 'cn',
      type: 'access',
      affectedSystemIds: ['sys-crm', 'sys-order', 'sys-marketing', 'sys-support', 'sys-risk'],
      identityMaterialType: 'masked-id',
      identityReference: '310***********0001',
      note: '断点恢复验证请求',
    },
    '客服专员',
  )
  const created = custom.requests[0]
  custom = {
    ...custom,
    requests: custom.requests.map((request) =>
      request.id === created.id
        ? {
            ...request,
            status: 'processing',
            identity: {
              ...request.identity,
              status: 'verified' as const,
              reviewedAt: '2026-10-01T00:00:00Z',
            },
            conflicts: [],
            tasks: request.tasks.map((task, index) => ({
              ...task,
              status: task.id.endsWith('-identity')
                ? ('completed' as const)
                : index === 1
                  ? ('active' as const)
                  : ('pending' as const),
              completedAt: task.id.endsWith('-identity') ? '2026-10-01T00:00:00Z' : undefined,
            })),
          }
        : request,
    ),
  }
  return custom
}

const systemNames = ['客户关系管理系统', '订单与交易平台', '营销自动化平台', '客服工单系统', '风控决策平台']
let resumeState = buildResumeState()
const resumeCode = resumeState.requests[0].code
const fiveLines = systemNames.map((systemName, index) => ({
  requestCode: resumeCode,
  systemName,
  executedAt: `2026-10-0${index + 1}T09:00:00Z`,
  outcome: 'completed' as const,
  resultSummary: `${systemName} 执行完成`,
  receiptRef: `RC-R${index}`,
}))
resumeState = importReceiptBatch(
  resumeState,
  {
    clientToken: 'window-A',
    externalBatchId: 'B4',
    partnerName: '合作方离线通道',
    receivedAt: '2026-10-07T04:00:00Z',
    lines: fiveLines,
    failAfter: 2,
  },
  '客服专员',
)
let b4 = resumeState.receiptBatches.find((b) => b.externalBatchId === 'B4')!
check('失败批次 partial-failed', b4.status === 'partial-failed')
check('已完成部分保留（2 行）', b4.items.filter((i) => i.status === 'applied').length === 2)
check('剩余 3 行 pending', b4.items.filter((i) => i.status === 'pending').length === 3)
check('断点 checkpoint=2', b4.checkpointIndex === 2, String(b4.checkpointIndex))
const resumeEvidenceBefore = resumeState.requests[0].evidence.length

resumeState = retryReceiptBatch(resumeState, b4.id, undefined, '客服专员')
b4 = resumeState.receiptBatches.find((b) => b.externalBatchId === 'B4')!
check('重试后批次 applied', b4.status === 'applied')
check('重试后无 pending', b4.items.every((i) => i.status !== 'pending'))
check('5 行全部 applied', b4.items.filter((i) => i.status === 'applied').length === 5)
check(
  '证据随恢复继续写入（再 +3）',
  resumeState.requests[0].evidence.length === resumeEvidenceBefore + 3,
  String(resumeState.requests[0].evidence.length),
)
check('任务全部完成进入待关闭', resumeState.requests[0].status === 'pending-close', JSON.stringify(resumeState.requests[0].tasks.map((t) => ({ id: t.id, status: t.status }))))

// 6. 前置条件不满足：req-002 身份未核验通过
state = importReceiptBatch(
  state,
  {
    clientToken: 'window-A',
    externalBatchId: 'B5',
    partnerName: '合作方离线通道',
    receivedAt: '2026-10-07T05:00:00Z',
    lines: [
      {
        requestCode: 'DSR-2026-002',
        systemName: '客户关系管理系统',
        executedAt: '2026-10-06T09:00:00Z',
        outcome: 'completed',
        resultSummary: '删除已执行',
        receiptRef: 'RC-PRE',
      },
    ],
  },
  '客服专员',
)
const b5 = state.receiptBatches.find((b) => b.externalBatchId === 'B5')!
check('身份未过进入 review-precondition', b5.items[0].status === 'review-precondition')
check('前置不满足不写证据', !state.requests.find((r) => r.code === 'DSR-2026-002')!.evidence.some((e) => e.source === 'partner-receipt'))

// 7. 未匹配请求 / 系统
state = importReceiptBatch(
  state,
  {
    clientToken: 'window-A',
    externalBatchId: 'B6',
    partnerName: '合作方离线通道',
    receivedAt: '2026-10-07T06:00:00Z',
    lines: [
      {
        requestCode: 'DSR-2026-999',
        systemName: '客户关系管理系统',
        executedAt: '2026-10-06T09:00:00Z',
        outcome: 'completed',
        resultSummary: '不存在的请求',
        receiptRef: 'RC-X1',
      },
      {
        requestCode: 'DSR-2026-001',
        systemName: '不存在系统',
        executedAt: '2026-10-06T09:00:00Z',
        outcome: 'completed',
        resultSummary: '不存在的系统',
        receiptRef: 'RC-X2',
      },
    ],
  },
  '客服专员',
)
const b6 = state.receiptBatches.find((b) => b.externalBatchId === 'B6')!
check('请求未匹配 review-unmatched', b6.items[0].status === 'review-unmatched')
check('系统未匹配 review-unmatched', b6.items[1].status === 'review-unmatched')

// 8. 同一回执指纹跨批次导入 → duplicate-reuse
const evidenceBeforeDup = state.requests.find((r) => r.code === 'DSR-2026-001')!.evidence.length
state = importReceiptBatch(
  state,
  {
    clientToken: 'window-C',
    externalBatchId: 'B7',
    partnerName: '另一合作方',
    receivedAt: '2026-10-07T07:00:00Z',
    lines: [lines[0]],
  },
  '客服专员',
)
const b7 = state.receiptBatches.find((b) => b.externalBatchId === 'B7')!
check('跨批重复回执 duplicate-reuse', b7.items[0].status === 'duplicate-reuse')
check('记录沿用来源批次', Boolean(b7.items[0].reusedFromBatchId))
check('重复回执不新增证据', state.requests.find((r) => r.code === 'DSR-2026-001')!.evidence.length === evidenceBeforeDup)

// 9. 请求详情合并视图
const merged = receiptsForRequest(state, 'req-001')
check('请求详情能看到跨批合并回执', merged.length >= 3, String(merged.length))

// 10. 不自动延期：B1 后 req-001 的 dueAt/extendedDays 不变
const req1Final = state.requests.find((r) => r.code === 'DSR-2026-001')!
check('回执导入不产生延期', req1Final.extendedDays === 0, String(req1Final.extendedDays))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
