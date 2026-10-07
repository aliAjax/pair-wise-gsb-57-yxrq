import type {
  ExecutionEvidence,
  PrivacyRequest,
  ReceiptBatch,
  ReceiptFieldDiff,
  ReceiptItem,
  ReceiptItemStatus,
  WorkspaceState,
} from '@/types/domain'
import { receiptOutcomeLabels } from '@/lib/schemas'

const cloneState = (state: WorkspaceState): WorkspaceState => structuredClone(state)
const now = () => new Date().toISOString()
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

export function digestText(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0')
}

export interface ReceiptLineInput {
  requestCode: string
  systemName: string
  executedAt: string
  outcome: 'completed' | 'partial' | 'failed'
  resultSummary: string
  receiptRef: string
}

export interface ImportReceiptBatchInput {
  clientToken: string
  externalBatchId: string
  partnerName: string
  receivedAt: string
  lines: ReceiptLineInput[]
  failAfter?: number
}

const REVIEW_STATUSES: ReceiptItemStatus[] = [
  'review-precondition',
  'review-diff',
  'review-concurrent',
  'review-unmatched',
]
const RETRYABLE_STATUSES: ReceiptItemStatus[] = [
  'pending',
  'review-precondition',
  'review-unmatched',
]

function appendGlobalAudit(
  state: WorkspaceState,
  action: string,
  operator: string,
  detail: string,
) {
  state.audit.unshift({ id: uid('audit'), action, operator, detail, createdAt: now() })
}

function appendRequestAudit(
  state: WorkspaceState,
  request: PrivacyRequest,
  action: string,
  operator: string,
  detail: string,
) {
  const entry = {
    id: uid('audit'),
    requestId: request.id,
    action,
    operator,
    detail,
    createdAt: now(),
  }
  state.audit.unshift(entry)
  request.audit.unshift({
    id: entry.id,
    action,
    operator,
    detail,
    createdAt: entry.createdAt,
  })
}

function normalizeLine(line: ReceiptLineInput) {
  return {
    requestCode: line.requestCode.trim(),
    systemName: line.systemName.trim(),
    executedAt: line.executedAt.trim(),
    outcome: line.outcome,
    resultSummary: line.resultSummary.trim(),
    receiptRef: line.receiptRef.trim(),
  }
}

function lineFingerprint(line: ReturnType<typeof normalizeLine>): string {
  return digestText(
    [
      line.requestCode,
      line.systemName,
      line.executedAt,
      line.outcome,
      line.resultSummary,
      line.receiptRef,
    ].join('|'),
  )
}

function payloadDigest(lines: ReceiptLineInput[]): string {
  return digestText(lines.map((line) => lineFingerprint(normalizeLine(line))).join('||'))
}

function parseExecutedAt(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
}

function findRequest(state: WorkspaceState, code: string) {
  return state.requests.find((request) => request.code === code)
}

function findSystem(state: WorkspaceState, name: string) {
  return state.systems.find((system) => system.name === name.trim())
}

function findReusedItem(
  state: WorkspaceState,
  batch: ReceiptBatch,
  fingerprint: string,
  selfItemId?: string,
) {
  for (const existingBatch of state.receiptBatches) {
    for (const item of existingBatch.items) {
      if (item.fingerprint !== fingerprint || item.id === selfItemId) continue
      if (existingBatch.id === batch.id && item.status === 'pending') continue
      return { batch: existingBatch, item }
    }
  }
  return undefined
}

function buildFieldDiffs(
  request: PrivacyRequest,
  task: PrivacyRequest['tasks'][number],
  line: ReturnType<typeof normalizeLine>,
  executedAtIso: string,
): ReceiptFieldDiff[] {
  const diffs: ReceiptFieldDiff[] = []
  const existingReceiptEvidence = [...request.evidence]
    .reverse()
    .find((evidence) => evidence.stepId === task.id && evidence.source === 'partner-receipt' && !evidence.superseded)

  if (['completed', 'rejected'].includes(request.status)) {
    diffs.push({ field: '请求状态', existing: `请求已${request.status === 'completed' ? '完成关闭' : '拒绝'}`, incoming: `回执批次登记 ${line.systemName} 结果` })
  }
  if (task.status === 'completed') {
    diffs.push({
      field: '任务状态',
      existing: '任务已标记完成',
      incoming: `回执结论：${receiptOutcomeLabels[line.outcome]}`,
    })
    if (task.completedAt && task.completedAt !== executedAtIso) {
      diffs.push({ field: '执行时间', existing: task.completedAt, incoming: executedAtIso })
    }
    diffs.push({
      field: '执行结果',
      existing: existingReceiptEvidence?.name ?? '人工登记的执行结果与证据',
      incoming: line.resultSummary,
    })
  } else if (task.status === 'blocked') {
    diffs.push({
      field: '任务状态',
      existing: `任务已阻断：${task.exceptionReason || '未填写原因'}`,
      incoming: `回执结论：${receiptOutcomeLabels[line.outcome]}；${line.resultSummary}`,
    })
  }
  return diffs
}

/**
 * 把单条回执写入任务与证据。失败调用方必须先经过人工采用，
 * 正常写入只发生在任务尚无执行结果时，绝不覆盖旧记录。
 */
function applyReceipt(
  state: WorkspaceState,
  request: PrivacyRequest,
  task: PrivacyRequest['tasks'][number],
  batch: ReceiptBatch,
  item: ReceiptItem,
  line: ReturnType<typeof normalizeLine>,
  supersede: boolean,
): void {
  const executedAtIso = parseExecutedAt(line.executedAt)
  if (supersede) {
    // 人工采用新回执时，该任务此前的回执与人工登记证据全部标记为已替代，
    // 但只做留痕标记，绝不物理删除或覆盖。
    request.evidence.forEach((evidence) => {
      if (evidence.stepId === task.id && !evidence.superseded) {
        evidence.superseded = true
      }
    })
  }
  const evidence: ExecutionEvidence = {
    id: uid('evidence'),
    stepId: task.id,
    name: line.resultSummary,
    evidenceType: 'system-response',
    digest: `RC-${item.fingerprint.slice(0, 8)}`,
    uploadedBy: batch.partnerName,
    uploadedAt: executedAtIso,
    protected: true,
    source: 'partner-receipt',
    receiptBatchId: batch.id,
    receiptItemId: item.id,
  }
  request.evidence.push(evidence)
  item.evidenceId = evidence.id
  item.taskId = task.id

  const conflictPrefix = `合作方回执 ${line.receiptRef}`
  const dropConflict = (prefix: string) => {
    request.conflicts = request.conflicts.filter((conflict) => !conflict.startsWith(prefix))
  }
  dropConflict(conflictPrefix)

  if (line.outcome === 'completed') {
    task.status = 'completed'
    task.completedAt = executedAtIso
    task.exceptionReason = ''
    // 合作方系统已回执执行结果，视为该系统的定位步骤一并完成。
    const locateTask = request.tasks.find(
      (candidate) => candidate.systemId === task.systemId && candidate.id.endsWith(`-locate-${task.systemId}`),
    )
    if (locateTask && locateTask.status !== 'completed') {
      locateTask.status = 'completed'
      locateTask.completedAt = executedAtIso
      locateTask.exceptionReason = ''
    }
    const nextTask = request.tasks.find((candidate) => candidate.status === 'pending')
    if (nextTask) nextTask.status = 'active'
  } else if (line.outcome === 'failed') {
    task.status = 'blocked'
    task.exceptionReason = `合作方回执（${line.receiptRef}）标记执行失败：${line.resultSummary}`
    request.conflicts.push(`${conflictPrefix} 标记执行失败：${line.resultSummary}，需要继续追办。`)
  } else {
    task.status = 'active'
    task.exceptionReason = `合作方回执（${line.receiptRef}）显示部分执行：${line.resultSummary}`
    request.conflicts.push(`${conflictPrefix} 显示部分执行：${line.resultSummary}，需要继续追办。`)
  }
  item.processedAt = now()
}

function recalculateRequestStatus(request: PrivacyRequest) {
  if (['completed', 'rejected'].includes(request.status)) return
  if (request.conflicts.length || request.tasks.some((task) => task.status === 'blocked')) {
    request.status = 'review-required'
    return
  }
  const executableTasks = request.tasks.filter(
    (task) => !task.id.endsWith('-close') && !task.id.endsWith('-review'),
  )
  const systemTasksComplete = request.tasks
    .filter((task) => task.id.includes('-locate-') || task.id.includes('-execute-'))
    .every((task) => task.status === 'completed')
  const mergeTask = request.tasks.find((task) => task.id.endsWith('-merge'))
  if (systemTasksComplete && mergeTask && mergeTask.status !== 'completed') {
    // 所有系统回执到齐后，批次自动完成跨系统结果合并。
    mergeTask.status = 'completed'
    mergeTask.completedAt = now()
    mergeTask.exceptionReason = ''
  }
  if (executableTasks.every((task) => task.status === 'completed')) {
    request.status = 'pending-close'
  } else if (request.identity.status === 'verified') {
    request.status = 'processing'
  }
}

type ItemVerdict =
  | { kind: 'applied'; request: PrivacyRequest; auditDetail: string }
  | { kind: 'review' }
  | { kind: 'duplicate' }
  | { kind: 'unmatched' }

function processItem(
  state: WorkspaceState,
  batch: ReceiptBatch,
  item: ReceiptItem,
): ItemVerdict | undefined {
  if (!['pending', 'review-precondition', 'review-unmatched'].includes(item.status)) {
    return undefined
  }
  const line = {
    requestCode: item.requestCode,
    systemName: item.systemName,
    executedAt: item.executedAt,
    outcome: item.outcome,
    resultSummary: item.resultSummary,
    receiptRef: item.receiptRef,
  }

  const reused = findReusedItem(state, batch, item.fingerprint, item.id)
  if (reused && reused.item.status !== 'pending') {
    item.status = 'duplicate-reuse'
    item.reusedFromBatchId = reused.batch.id
    item.reusedFromItemId = reused.item.id
    item.requestId = reused.item.requestId ?? findRequest(state, item.requestCode)?.id
    item.systemId = reused.item.systemId ?? findSystem(state, item.systemName)?.id
    item.taskId = reused.item.taskId
    item.evidenceId = reused.item.evidenceId
    item.reviewReason = `同一回执已在批次 ${reused.batch.externalBatchId} 对账，沿用原结果，不重复生成证据、审计或延期。`
    item.processedAt = now()
    return { kind: 'duplicate' }
  }

  const request = findRequest(state, item.requestCode)
  const system = findSystem(state, item.systemName)
  const task =
    request && system
      ? request.tasks.find((candidate) => candidate.id === `${request.id}-execute-${system.id}`)
      : undefined

  if (!request || !system || !task) {
    item.status = 'review-unmatched'
    const reasons: string[] = []
    if (!request) reasons.push(`未找到请求 ${item.requestCode}`)
    if (request && !system) reasons.push(`未找到系统「${item.systemName}」`)
    if (request && system && !task) reasons.push(`请求 ${item.requestCode} 没有系统「${item.systemName}」的执行任务`)
    item.reviewReason = `回执无法按系统任务匹配：${reasons.join('；')}。`
    return { kind: 'unmatched' }
  }

  item.requestId = request.id
  item.systemId = system.id

  if (request.identity.status !== 'verified') {
    item.status = 'review-precondition'
    item.reviewReason = '身份核验尚未通过，不能按回执写入执行结果；前置条件满足后可断点重试。'
    return { kind: 'review' }
  }

  const executedAtIso = parseExecutedAt(item.executedAt)
  const diffs = buildFieldDiffs(request, task, line, executedAtIso)
  if (diffs.length) {
    item.status = 'review-diff'
    item.diffs = diffs
    item.taskId = task.id
    item.reviewReason =
      task.status === 'completed'
        ? '任务已有执行结果，新回执不会覆盖旧记录，请人工比对两边差异后选择。'
        : '任务对象相对回执发生变化（已阻断或请求已关闭），请人工比对后选择。'
    return { kind: 'review' }
  }

  applyReceipt(state, request, task, batch, item, line, false)
  item.status = 'applied'
  recalculateRequestStatus(request)
  return {
    kind: 'applied',
    request,
    auditDetail: `${item.systemName} 回执 ${item.receiptRef}：${receiptOutcomeLabels[item.outcome]}，${item.resultSummary}`,
  }
}

function createItem(lineInput: ReceiptLineInput, lineNo: number): ReceiptItem {
  const line = normalizeLine(lineInput)
  return {
    id: uid('receipt-item'),
    lineNo,
    receiptRef: line.receiptRef,
    fingerprint: lineFingerprint(line),
    partnerRef: '',
    requestCode: line.requestCode,
    systemName: line.systemName,
    executedAt: line.executedAt,
    outcome: line.outcome,
    resultSummary: line.resultSummary,
    status: 'pending',
    reviewReason: '',
    diffs: [],
    decisionNote: '',
  }
}

function refreshBatchStatus(batch: ReceiptBatch) {
  if (batch.items.some((item) => item.status === 'pending')) {
    batch.status = 'partial-failed'
    return
  }
  if (batch.items.some((item) => REVIEW_STATUSES.includes(item.status))) {
    batch.status = 'review-required'
    return
  }
  batch.status = 'applied'
  batch.failureReason = ''
}

/**
 * 模拟合作方通道在写入若干行后失败：已完成行保留在工作区，
 * 未处理行保持 pending，批次标记 partial-failed 等待断点重试。
 */
class BatchWriteFailure extends Error {
  constructor(public checkpointIndex: number) {
    super('回执批次写入中断')
  }
}

function runProcessing(
  state: WorkspaceState,
  batch: ReceiptBatch,
  failAfter: number | undefined,
  operator: string,
): { touched: Map<string, PrivacyRequest>; failed: boolean } {
  const touched = new Map<string, PrivacyRequest>()
  let processed = 0
  let failed = false
  for (const item of batch.items) {
    if (!RETRYABLE_STATUSES.includes(item.status)) continue
    if (typeof failAfter === 'number' && processed >= failAfter) {
      failed = true
      break
    }
    const verdict = processItem(state, batch, item)
    if (verdict) {
      processed += 1
      if (verdict.kind === 'applied') {
        touched.set(verdict.request.id, verdict.request)
        appendRequestAudit(
          state,
          verdict.request,
          '回执对账写入',
          operator,
          verdict.auditDetail,
        )
      }
    }
  }
  if (failed) {
    const pendingIndex = batch.items.findIndex((item) => item.status === 'pending')
    batch.checkpointIndex = pendingIndex >= 0 ? pendingIndex : batch.items.length
    batch.status = 'partial-failed'
    batch.failureReason = `合作方通道在第 ${processed} 行后写入失败，已保留完成部分，可从第 ${batch.checkpointIndex + 1} 行断点重试。`
  } else {
    refreshBatchStatus(batch)
  }
  return { touched, failed }
}

export function importReceiptBatch(
  state: WorkspaceState,
  input: ImportReceiptBatchInput,
  operator: string,
): WorkspaceState {
  const draft = cloneState(state)
  const digest = payloadDigest(input.lines)
  const existing = draft.receiptBatches.find(
    (batch) => batch.externalBatchId === input.externalBatchId.trim(),
  )

  if (existing) {
    // 两个窗口同时提交同一批次：先到者已经写入，后到者整批进入复核，绝不覆盖。
    if (existing.clientToken !== input.clientToken) {
      const concurrent: ReceiptBatch = {
        id: uid('receipt-batch'),
        externalBatchId: existing.externalBatchId,
        partnerName: input.partnerName.trim(),
        receivedAt: input.receivedAt.trim(),
        importedAt: now(),
        importedBy: operator,
        clientToken: input.clientToken,
        payloadDigest: digest,
        status: 'review-required',
        failureReason: '',
        checkpointIndex: input.lines.length,
        totalLines: input.lines.length,
        items: input.lines.map((line, index) => {
          const item = createItem(line, index + 1)
          const normalized = normalizeLine(line)
          const request = findRequest(draft, item.requestCode)
          const system = findSystem(draft, item.systemName)
          const task =
            request && system
              ? request.tasks.find(
                  (candidate) => candidate.id === `${request.id}-execute-${system.id}`,
                )
              : undefined
          item.requestId = request?.id
          item.systemId = system?.id
          item.taskId = task?.id
          item.status = task ? 'review-concurrent' : 'review-unmatched'
          item.reviewReason = task
            ? `同一批次已由另一窗口（${existing.importedBy}，${existing.importedAt}）率先写入，后到提交进入人工复核，不能覆盖既有证据、审计或期限。`
            : '后到提交且回执无法匹配到请求的系统任务，需要人工核对。'
          item.diffs = task && request ? buildFieldDiffs(request, task, normalized, parseExecutedAt(normalized.executedAt)) : []
          return item
        }),
      }
      draft.receiptBatches.unshift(concurrent)
      appendGlobalAudit(
        draft,
        '并发回执批次转入复核',
        operator,
        `批次 ${input.externalBatchId} 已由窗口 ${existing.clientToken.slice(0, 8)} 率先写入，后到提交整批进入复核。`,
      )
      draft.revision += 1
      return draft
    }

    // 同一窗口重复提交：内容一致时完全沿用原结果，不重复生成证据、审计或延期。
    if (existing.payloadDigest === digest) {
      existing.reimports = existing.reimports ?? []
      existing.reimports.push({ clientToken: input.clientToken, at: now(), operator })
      draft.revision += 1
      return draft
    }

    // 同窗口但批次内容有新增：仅追加新指纹的回执行，已对账行保持原结果。
    const knownFingerprints = new Set(existing.items.map((item) => item.fingerprint))
    const additions = input.lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => !knownFingerprints.has(lineFingerprint(normalizeLine(line))))
    additions.forEach(({ line }, offset) => {
      existing.items.push(createItem(line, existing.items.length + offset + 1))
    })
    existing.totalLines = existing.items.length
    const { touched } = runProcessing(draft, existing, input.failAfter, operator)
    touched.forEach((request) => recalculateRequestStatus(request))
    appendGlobalAudit(
      draft,
      '补充导入回执批次',
      operator,
      `批次 ${existing.externalBatchId} 追加 ${additions.length} 条新回执，原有结果保持不变。`,
    )
    draft.revision += 1
    return draft
  }

  const batch: ReceiptBatch = {
    id: uid('receipt-batch'),
    externalBatchId: input.externalBatchId.trim(),
    partnerName: input.partnerName.trim(),
    receivedAt: input.receivedAt.trim(),
    importedAt: now(),
    importedBy: operator,
    clientToken: input.clientToken,
    payloadDigest: digest,
    status: 'processing',
    failureReason: '',
    checkpointIndex: 0,
    totalLines: input.lines.length,
    items: input.lines.map((line, index) => createItem(line, index + 1)),
  }
  draft.receiptBatches.unshift(batch)
  const { touched, failed } = runProcessing(draft, batch, input.failAfter, operator)
  touched.forEach((request) => recalculateRequestStatus(request))
  appendGlobalAudit(
    draft,
    failed ? '回执批次部分写入' : '导入回执批次',
    operator,
    failed
      ? `批次 ${batch.externalBatchId} 写入中断，已保留 ${batch.checkpointIndex} 行完成结果。`
      : `批次 ${batch.externalBatchId} 共 ${batch.items.length} 条回执完成对账，结果已合并到对应请求。`,
  )
  draft.revision += 1
  return draft
}

export function retryReceiptBatch(
  state: WorkspaceState,
  batchId: string,
  failAfter: number | undefined,
  operator: string,
): WorkspaceState {
  const draft = cloneState(state)
  const batch = draft.receiptBatches.find((item) => item.id === batchId)
  if (!batch) throw new Error('回执批次不存在')
  if (!batch.items.some((item) => RETRYABLE_STATUSES.includes(item.status))) {
    throw new Error('该批次没有可恢复的断点行（差异与并发项需人工复核）')
  }
  const startIndex = batch.items.findIndex((item) => RETRYABLE_STATUSES.includes(item.status))
  const { touched, failed } = runProcessing(draft, batch, failAfter, operator)
  touched.forEach((request) => recalculateRequestStatus(request))
  appendGlobalAudit(
    draft,
    failed ? '回执批次重试再次中断' : '回执批次断点重试完成',
    operator,
    failed
      ? `批次 ${batch.externalBatchId} 重试在断点后再次中断，保留已完成部分。`
      : `批次 ${batch.externalBatchId} 从第 ${startIndex + 1} 行恢复，剩余回执全部对账完成。`,
  )
  draft.revision += 1
  return draft
}

export function decideReceiptItem(
  state: WorkspaceState,
  batchId: string,
  itemId: string,
  choice: 'keep-existing' | 'adopt-receipt',
  note: string,
  operator: string,
): WorkspaceState {
  const draft = cloneState(state)
  const batch = draft.receiptBatches.find((item) => item.id === batchId)
  if (!batch) throw new Error('回执批次不存在')
  const item = batch.items.find((candidate) => candidate.id === itemId)
  if (!item) throw new Error('回执行不存在')
  if (!['review-diff', 'review-concurrent'].includes(item.status)) {
    throw new Error('该回执行不是差异或并发复核项')
  }
  const request = item.requestId ? draft.requests.find((req) => req.id === item.requestId) : undefined
  const system = item.systemId ? draft.systems.find((sys) => sys.id === item.systemId) : undefined
  const task =
    request && system
      ? request.tasks.find((candidate) => candidate.id === item.taskId)
      : undefined

  if (choice === 'adopt-receipt') {
    if (!request || !task) throw new Error('复核项缺少匹配的请求或任务，不能采用回执')
    const line = {
      requestCode: item.requestCode,
      systemName: item.systemName,
      executedAt: item.executedAt,
      outcome: item.outcome,
      resultSummary: item.resultSummary,
      receiptRef: item.receiptRef,
    }
    applyReceipt(draft, request, task, batch, item, line, true)
    item.status = 'adopted-receipt'
    item.decidedBy = operator
    item.decidedAt = now()
    item.decisionNote = note
    recalculateRequestStatus(request)
    appendRequestAudit(
      draft,
      request,
      '回执差异人工采用新回执',
      operator,
      `${item.systemName} 回执 ${item.receiptRef} 经人工确认采用；原回执证据保留并标记为已替代，不做物理覆盖。${note}`,
    )
  } else {
    item.status = 'kept-existing'
    item.decidedBy = operator
    item.decidedAt = now()
    item.decisionNote = note
    if (request) {
      appendRequestAudit(
        draft,
        request,
        '回执差异人工保留既有记录',
        operator,
        `${item.systemName} 回执 ${item.receiptRef} 与既有记录存在差异，人工决定保留原记录，新回执不覆盖。${note}`,
      )
    }
  }
  refreshBatchStatus(batch)
  draft.revision += 1
  return draft
}

export function dismissReceiptItem(
  state: WorkspaceState,
  batchId: string,
  itemId: string,
  note: string,
  operator: string,
): WorkspaceState {
  const draft = cloneState(state)
  const batch = draft.receiptBatches.find((item) => item.id === batchId)
  if (!batch) throw new Error('回执批次不存在')
  const item = batch.items.find((candidate) => candidate.id === itemId)
  if (!item) throw new Error('回执行不存在')
  if (!REVIEW_STATUSES.includes(item.status)) {
    throw new Error('该回执行已经处理完成，无需关闭')
  }
  const request = item.requestId ? draft.requests.find((req) => req.id === item.requestId) : undefined
  item.status = 'kept-existing'
  item.decidedBy = operator
  item.decidedAt = now()
  item.decisionNote = note
  if (request) {
    appendRequestAudit(
      draft,
      request,
      '回执复核项人工关闭',
      operator,
      `${item.systemName} 回执 ${item.receiptRef}（${item.reviewReason}）人工确认：${note}`,
    )
  } else {
    appendGlobalAudit(
      draft,
      '回执复核项人工关闭',
      operator,
      `批次 ${batch.externalBatchId} 行 ${item.lineNo}：${note}`,
    )
  }
  refreshBatchStatus(batch)
  draft.revision += 1
  return draft
}

/** 汇总同一请求在所有批次中的回执对账结果（同一批及跨批均合并展示）。 */
export function receiptsForRequest(
  state: WorkspaceState,
  requestId: string,
): { batch: ReceiptBatch; item: ReceiptItem }[] {
  return state.receiptBatches
    .flatMap((batch) => batch.items.map((item) => ({ batch, item })))
    .filter(({ item }) => item.requestId === requestId)
    .sort((left, right) => right.batch.importedAt.localeCompare(left.batch.importedAt))
}

export function batchRequestSummary(batch: ReceiptBatch) {
  const groups = new Map<
    string,
    { code: string; total: number; applied: number; review: number; duplicate: number }
  >()
  for (const item of batch.items) {
    const group = groups.get(item.requestCode) ?? {
      code: item.requestCode,
      total: 0,
      applied: 0,
      review: 0,
      duplicate: 0,
    }
    group.total += 1
    if (['applied', 'adopted-receipt'].includes(item.status)) group.applied += 1
    else if (REVIEW_STATUSES.includes(item.status)) group.review += 1
    else if (item.status === 'duplicate-reuse') group.duplicate += 1
    groups.set(item.requestCode, group)
  }
  return [...groups.values()]
}
