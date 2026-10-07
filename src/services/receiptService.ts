import type {
  PrivacyRequest,
  ReceiptBatch,
  ReceiptDiff,
  ReceiptItem,
  ReceiptItemStatus,
  ReceiptResult,
  WorkspaceState,
  WorkflowStep,
} from '@/types/domain'
import { receiptResultLabels } from '@/lib/schemas'

const cloneState = (state: WorkspaceState): WorkspaceState => structuredClone(state)
const now = () => new Date().toISOString()
const batchId = () => `receipt-batch-${crypto.randomUUID()}`
const itemId = () => `receipt-item-${crypto.randomUUID()}`

function fnv(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0')
}

const receiptFingerprint = (content: string) => `RC-${fnv(content)}`

function appendAudit(
  state: WorkspaceState,
  request: PrivacyRequest | undefined,
  action: string,
  operator: string,
  detail: string,
  createdAt = now(),
) {
  const entry = {
    id: `audit-${crypto.randomUUID()}`,
    requestId: request?.id,
    action,
    operator,
    detail,
    createdAt,
  }
  state.audit.unshift(entry)
  if (request) {
    request.audit.unshift({
      id: entry.id,
      action,
      operator,
      detail,
      createdAt: entry.createdAt,
    })
  }
}

export interface ReceiptItemInput {
  requestCode: string
  systemId: string
  result: ReceiptResult
  executedAt: string
  receiptRef: string
  message: string
}

interface PreparedItem extends ReceiptItemInput {
  fingerprint: string
}

function prepareItems(items: ReceiptItemInput[]): PreparedItem[] {
  return items.map((item) => ({
    ...item,
    requestCode: item.requestCode.trim(),
    systemId: item.systemId.trim(),
    receiptRef: item.receiptRef.trim(),
    message: item.message.trim(),
    executedAt:
      !item.executedAt || Number.isNaN(new Date(item.executedAt).getTime())
        ? now()
        : new Date(item.executedAt).toISOString(),
    fingerprint: receiptFingerprint(
      [
        item.requestCode.trim(),
        item.systemId.trim(),
        item.receiptRef.trim(),
        item.result,
        item.executedAt,
        item.message.trim(),
      ].join('|'),
    ),
  }))
}

function batchDigest(batchCode: string, source: string, items: PreparedItem[]): string {
  const canonical = items
    .map(
      (item) =>
        `${item.requestCode}|${item.systemId}|${item.receiptRef}|${item.result}|${item.executedAt}|${item.message}`,
    )
    .sort()
    .join('||')
  return `BD-${fnv(`${batchCode}|${source}|${canonical}`)}`
}

const taskStatusLabels: Record<WorkflowStep['status'], string> = {
  pending: '未开始',
  active: '执行中',
  completed: '已完成',
  blocked: '已阻断',
}

function impliedTaskStatus(result: ReceiptResult): WorkflowStep['status'] {
  return result === 'executed' ? 'completed' : 'blocked'
}

/** 已入账（占过任务结果）的回执条目，用于查重与差异对比。 */
function findLedgerItem(
  state: WorkspaceState,
  requestId: string,
  taskId: string,
  self?: { batchId: string; itemId: string },
): ReceiptItem | undefined {
  const ledgerStatuses: ReceiptItemStatus[] = [
    'applied',
    'kept-existing',
    'accepted-incoming',
  ]
  for (const batch of state.receiptBatches) {
    for (const item of batch.items) {
      if (self && batch.id === self.batchId && item.id === self.itemId) continue
      if (
        item.matchedRequestId === requestId &&
        item.matchedTaskId === taskId &&
        ledgerStatuses.includes(item.status)
      ) {
        return item
      }
    }
  }
  return undefined
}

function findAnyFingerprint(
  state: WorkspaceState,
  fingerprint: string,
  self?: { batchId: string; itemId: string },
): ReceiptItem | undefined {
  for (const batch of state.receiptBatches) {
    const found = batch.items.find(
      (item) =>
        item.fingerprint === fingerprint &&
        !(self && batch.id === self.batchId && item.id === self.itemId),
    )
    if (found) return found
  }
  return undefined
}

/** 对比回执与任务对象/已有执行结果，只有真正不一致才列为差异。 */
function buildDiffs(
  state: WorkspaceState,
  request: PrivacyRequest,
  task: WorkflowStep,
  incoming: PreparedItem,
  ledger: ReceiptItem | undefined,
): ReceiptDiff[] {
  const diffs: ReceiptDiff[] = []
  const system = state.systems.find((item) => item.id === incoming.systemId)
  const systemName = system?.name ?? incoming.systemId
  const implied = impliedTaskStatus(incoming.result)

  if (ledger) {
    if (ledger.result !== incoming.result) {
      diffs.push({
        field: 'result',
        label: '执行结果',
        existing: receiptResultLabels[ledger.result],
        incoming: receiptResultLabels[incoming.result],
      })
    }
    if (ledger.executedAt !== incoming.executedAt) {
      diffs.push({
        field: 'executedAt',
        label: '回执执行时间',
        existing: new Date(ledger.executedAt).toLocaleString('zh-CN'),
        incoming: new Date(incoming.executedAt).toLocaleString('zh-CN'),
      })
    }
    if (ledger.message !== incoming.message) {
      diffs.push({
        field: 'message',
        label: '回执说明',
        existing: ledger.message || '（空）',
        incoming: incoming.message || '（空）',
      })
    }
    if (ledger.receiptRef !== incoming.receiptRef) {
      diffs.push({
        field: 'receiptRef',
        label: '回执编号',
        existing: ledger.receiptRef,
        incoming: incoming.receiptRef,
      })
    }
  }

  if (task.status !== implied) {
    diffs.push({
      field: 'taskStatus',
      label: `任务对象状态（${task.name}）`,
      existing: taskStatusLabels[task.status],
      incoming: taskStatusLabels[implied],
    })
  }
  if (implied === 'completed' && task.completedAt && task.completedAt !== incoming.executedAt) {
    diffs.push({
      field: 'taskCompletedAt',
      label: '任务完成时间',
      existing: new Date(task.completedAt).toLocaleString('zh-CN'),
      incoming: new Date(incoming.executedAt).toLocaleString('zh-CN'),
    })
  }
  const existingException = task.exceptionReason || ''
  const incomingException =
    incoming.result === 'executed'
      ? ''
      : `系统回执${incoming.result === 'rejected' ? '拒绝执行' : '部分执行'}：${incoming.message}`
  if (incomingException && existingException !== incomingException) {
    diffs.push({
      field: 'taskException',
      label: `${systemName}阻断原因`,
      existing: existingException || '（无）',
      incoming: incomingException,
    })
  }
  return diffs
}

function conflictMarker(batchIdValue: string, itemKeyValue: string) {
  return `【回执对账 ${batchIdValue}/${itemKeyValue}】`
}

function batchMarker(batchIdValue: string) {
  return `【并发回执 ${batchIdValue}】`
}

function recomputeRequestStatus(request: PrivacyRequest) {
  if (request.conflicts.length) {
    request.status = 'review-required'
    return
  }
  const executableTasks = request.tasks.filter((task) => !task.id.endsWith('-close'))
  if (executableTasks.every((task) => task.status === 'completed')) {
    request.status = 'pending-close'
  } else {
    request.status = 'processing'
  }
}

/** 将一条回执写入任务与证据；调用方已确认不存在冲突或已获得人工授权。 */
function applyLedgerEntry(
  state: WorkspaceState,
  request: PrivacyRequest,
  task: WorkflowStep,
  batch: ReceiptBatch,
  item: ReceiptItem,
  operator: string,
  allowReplaceReceiptEvidence: boolean,
) {
  const system = state.systems.find((entry) => entry.id === item.systemId)
  const systemName = system?.name ?? item.systemId

  if (allowReplaceReceiptEvidence) {
    request.evidence = request.evidence.filter(
      (evidence) => !(evidence.stepId === task.id && evidence.name.startsWith('系统回执 ')),
    )
  }
  const evidenceExists = request.evidence.some(
    (evidence) => evidence.stepId === task.id && evidence.digest === item.fingerprint,
  )

  if (!evidenceExists) {
    request.evidence.push({
      id: `evidence-${crypto.randomUUID()}`,
      stepId: task.id,
      name: `系统回执 ${item.receiptRef}：${receiptResultLabels[item.result]} · ${item.message}`,
      evidenceType: 'system-response',
      digest: item.fingerprint,
      uploadedBy: system?.owner ?? batch.source,
      uploadedAt: item.executedAt,
      protected: true,
    })
  }

  const locateTask = request.tasks.find(
    (entry) => entry.systemId === item.systemId && entry.id.includes('-locate-'),
  )
  if (locateTask && locateTask.status !== 'completed') {
    locateTask.status = 'completed'
    locateTask.completedAt ??= item.executedAt
    locateTask.exceptionReason = ''
  }

  if (item.result === 'executed') {
    task.status = 'completed'
    task.completedAt ??= item.executedAt
    task.exceptionReason = ''
  } else {
    task.status = 'blocked'
    task.exceptionReason = `系统回执${item.result === 'rejected' ? '拒绝执行' : '部分执行'}：${item.message}`
    const marker = conflictMarker(batch.id, item.id)
    const text = `${marker}${systemName}回执${receiptResultLabels[item.result]}：${item.message}，需要继续追踪处理。`
    if (!request.conflicts.some((conflict) => conflict.startsWith(marker))) {
      request.conflicts.push(text)
    }
  }

  recomputeRequestStatus(request)
  appendAudit(
    state,
    request,
    '回执对账入账',
    operator,
    `批次 ${batch.batchCode}：${request.code} / ${systemName} 回执“${receiptResultLabels[item.result]}”${item.message ? `（${item.message}）` : ''}，证据仅登记一次。`,
  )
}

function computeBatchStatus(batch: ReceiptBatch): ReceiptBatch['status'] {
  if (batch.items.some((item) => item.status === 'conflict' || item.status === 'pending')) {
    return 'review-required'
  }
  if (batch.items.some((item) => item.status === 'failed')) return 'partial'
  if (
    batch.items.every(
      (item) => item.status === 'duplicate' || item.status === 'kept-existing',
    )
  ) {
    return 'duplicate'
  }
  return 'applied'
}

function refreshBatchStatus(batch: ReceiptBatch) {
  batch.status = computeBatchStatus(batch)
  batch.lastAttemptAt = now()
}

type Classification =
  | { outcome: 'applied' }
  | { outcome: 'duplicate'; original: ReceiptItem }
  | { outcome: 'conflict'; diffs: ReceiptDiff[] }
  | { outcome: 'failed'; reason: string }

function classify(
  state: WorkspaceState,
  incoming: PreparedItem,
  self: { batchId: string; itemId: string },
): { classification: Classification; request?: PrivacyRequest; task?: WorkflowStep } {
  const request = state.requests.find((item) => item.code === incoming.requestCode)
  if (!request) {
    return { classification: { outcome: 'failed', reason: `未找到请求 ${incoming.requestCode}` } }
  }
  if (!request.affectedSystemIds.includes(incoming.systemId)) {
    return {
      classification: {
        outcome: 'failed',
        reason: `请求 ${incoming.requestCode} 不涉及系统 ${incoming.systemId}，任务对象可能已调整`,
      },
      request,
    }
  }
  const task = request.tasks.find(
    (item) => item.id === `${request.id}-execute-${incoming.systemId}`,
  )
  if (!task) {
    return {
      classification: {
        outcome: 'failed',
        reason: `${incoming.requestCode} 在 ${incoming.systemId} 的执行任务缺失`,
      },
      request,
    }
  }
  if (request.identity.status !== 'verified') {
    return {
      classification: {
        outcome: 'failed',
        reason: '身份核验尚未通过，回执暂不能入账，核验后可断点重试',
      },
      request,
      task,
    }
  }

  const priorSameReceipt = findAnyFingerprint(state, incoming.fingerprint, self)
  if (priorSameReceipt) {
    return { classification: { outcome: 'duplicate', original: priorSameReceipt }, request, task }
  }

  const ledger = findLedgerItem(state, request.id, task.id, self)
  if (ledger) {
    return {
      classification: { outcome: 'conflict', diffs: buildDiffs(state, request, task, incoming, ledger) },
      request,
      task,
    }
  }

  // 没有历史回执，但任务已经手工执行/阻断或存在人工执行证据：任务对象已有结果，需要列差异。
  const hasManualResult =
    task.status === 'completed' ||
    task.status === 'blocked' ||
    (task.status === 'active' && request.evidence.some((entry) => entry.stepId === task.id))
  if (hasManualResult) {
    const diffs = buildDiffs(state, request, task, incoming, undefined)
    if (diffs.length) {
      return { classification: { outcome: 'conflict', diffs }, request, task }
    }
  }

  return { classification: { outcome: 'applied' }, request, task }
}

export interface ImportReceiptsParams {
  batchCode: string
  source: string
  operator: string
  failAt: number
  items: ReceiptItemInput[]
}

export function importReceipts(
  state: WorkspaceState,
  params: ImportReceiptsParams,
): WorkspaceState {
  const draft = cloneState(state)
  const prepared = prepareItems(params.items)
  const digest = batchDigest(params.batchCode.trim(), params.source.trim(), prepared)
  const existing = draft.receiptBatches.find(
    (batch) => batch.batchCode === params.batchCode.trim(),
  )

  // 同一批次重复/并发提交：先到者已写入，后到者一律不得覆盖，进入复核或直接沿用。
  if (existing) {
    const sameDigest = existing.digest === digest
    const concurrentBatch: ReceiptBatch = {
      id: batchId(),
      batchCode: existing.batchCode,
      source: params.source.trim(),
      importedBy: params.operator,
      importedAt: now(),
      digest,
      status: sameDigest ? 'duplicate' : 'review-required',
      concurrent: true,
      concurrentOf: existing.id,
      attempts: 1,
      lastAttemptAt: now(),
      items: prepared.map((entry) => {
        const request = draft.requests.find((item) => item.code === entry.requestCode)
        const task = request?.tasks.find(
          (item) => item.id === `${request.id}-execute-${entry.systemId}`,
        )
        return {
          id: itemId(),
          receiptRef: entry.receiptRef,
          requestCode: entry.requestCode,
          systemId: entry.systemId,
          result: entry.result,
          executedAt: entry.executedAt,
          message: entry.message,
          fingerprint: entry.fingerprint,
          status: sameDigest ? 'duplicate' : 'pending',
          matchedRequestId: request?.id,
          matchedTaskId: task?.id,
          diffs: [],
          errorReason: '',
          processedAt: sameDigest ? now() : undefined,
        }
      }),
    }

    if (sameDigest) {
      appendAudit(
        draft,
        undefined,
        '回执批次重复导入',
        params.operator,
        `批次 ${existing.batchCode} 内容完全一致（${digest}），沿用首次导入结果，未重复生成证据、审计或延期。`,
      )
    } else {
      appendAudit(
        draft,
        undefined,
        '并发回执批次进入复核',
        params.operator,
        `批次 ${existing.batchCode} 已有窗口先写入（先到批次 ${existing.id}），本次提交内容不同（${digest}），整批进入人工复核，未覆盖任何记录。`,
      )
      const marker = batchMarker(concurrentBatch.id)
      concurrentBatch.items.forEach((item) => {
        const request = draft.requests.find((entry) => entry.id === item.matchedRequestId)
        if (!request) return
        const text = `${marker}并发提交批次 ${existing.batchCode} 与首批内容不一致，等待人工选择。`
        if (!request.conflicts.some((conflict) => conflict.includes(marker))) {
          request.conflicts.push(text)
          request.status = 'review-required'
        }
        appendAudit(
          draft,
          request,
          '并发回执待人工选择',
          params.operator,
          `回执 ${item.receiptRef}（${item.requestCode}/${item.systemId}）未写入，等待选择沿用首批或采用本次提交。`,
        )
      })
    }

    draft.receiptBatches.unshift(concurrentBatch)
    draft.revision += 1
    return draft
  }

  const batch: ReceiptBatch = {
    id: batchId(),
    batchCode: params.batchCode.trim(),
    source: params.source.trim(),
    importedBy: params.operator,
    importedAt: now(),
    digest,
    status: 'applied',
    concurrent: false,
    attempts: 1,
    lastAttemptAt: now(),
    items: [],
  }

  prepared.forEach((entry, index) => {
    const record: ReceiptItem = {
      id: itemId(),
      receiptRef: entry.receiptRef,
      requestCode: entry.requestCode,
      systemId: entry.systemId,
      result: entry.result,
      executedAt: entry.executedAt,
      message: entry.message,
      fingerprint: entry.fingerprint,
      status: 'pending',
      diffs: [],
      errorReason: '',
    }
    batch.items.push(record)

    if (index === params.failAt) {
      record.status = 'failed'
      record.errorReason = '批次写入在该条目后中断，已完成部分保留；重试将从断点继续。'
      appendAudit(
        draft,
        undefined,
        '回执批次写入中断',
        params.operator,
        `批次 ${batch.batchCode} 在第 ${index + 1} 条（${entry.requestCode}/${entry.systemId}）写入失败，前序结果保留。`,
      )
    } else if (params.failAt >= 0 && index > params.failAt) {
      record.status = 'failed'
      record.errorReason = '批次中断前未写入，等待断点重试。'
    }
  })

  // 仅处理断点之前的条目；failed 条目等待重试。
  const stopIndex = params.failAt >= 0 ? params.failAt : batch.items.length
  batch.items.slice(0, stopIndex).forEach((record, offset) => {
    const entry = prepared[offset]
    processItem(draft, batch, record, entry, params.operator)
  })

  refreshBatchStatus(batch)
  draft.receiptBatches.unshift(batch)
  appendAudit(
    draft,
    undefined,
    '导入回执批次',
    params.operator,
    `批次 ${batch.batchCode}（${digest}）共 ${batch.items.length} 条：${countSummary(batch)}。`,
  )
  draft.revision += 1
  return draft
}

function countSummary(batch: ReceiptBatch): string {
  const counts = new Map<ReceiptItemStatus, number>()
  batch.items.forEach((item) => counts.set(item.status, (counts.get(item.status) ?? 0) + 1))
  return [...counts.entries()].map(([status, count]) => `${status} ${count}`).join('，')
}

function processItem(
  draft: WorkspaceState,
  batch: ReceiptBatch,
  record: ReceiptItem,
  entry: PreparedItem,
  operator: string,
) {
  const settled: ReceiptItemStatus[] = ['applied', 'duplicate', 'kept-existing', 'accepted-incoming']
  const earlier = batch.items.find(
    (other) => other !== record && other.fingerprint === record.fingerprint && settled.includes(other.status),
  )
  if (earlier) {
    record.status = 'duplicate'
    record.matchedRequestId = earlier.matchedRequestId
    record.matchedTaskId = earlier.matchedTaskId
    record.processedAt = now()
    return
  }

  const { classification, request, task } = classify(draft, entry, {
    batchId: batch.id,
    itemId: record.id,
  })
  record.matchedRequestId = request?.id
  record.matchedTaskId = task?.id

  if (classification.outcome === 'applied' && request && task) {
    applyLedgerEntry(draft, request, task, batch, record, operator, false)
    record.status = 'applied'
    record.processedAt = now()
    return
  }

  if (classification.outcome === 'duplicate') {
    record.status = 'duplicate'
    record.matchedRequestId = classification.original.matchedRequestId
    record.matchedTaskId = classification.original.matchedTaskId
    record.processedAt = now()
    return
  }

  if (classification.outcome === 'conflict' && request) {
    record.status = 'conflict'
    record.diffs = classification.diffs
    record.processedAt = now()
    const marker = conflictMarker(batch.id, record.id)
    if (!request.conflicts.some((conflict) => conflict.startsWith(marker))) {
      request.conflicts.push(
        `${marker}回执 ${record.receiptRef} 与 ${record.requestCode} 已有执行结果/任务对象存在 ${classification.diffs.length} 项差异，不能用新回执覆盖旧记录，等待人工选择。`,
      )
      request.status = 'review-required'
    }
    appendAudit(
      draft,
      request,
      '回执差异待人工选择',
      operator,
      `批次 ${batch.batchCode} 回执 ${record.receiptRef} 存在差异：${classification.diffs
        .map((diff) => `${diff.label}「${diff.existing}→${diff.incoming}」`)
        .join('；')}。`,
    )
    return
  }

  if (classification.outcome === 'failed') {
    record.status = 'failed'
    record.errorReason = classification.reason
    appendAudit(
      draft,
      request,
      '回执条目写入失败',
      operator,
      `批次 ${batch.batchCode}：${record.requestCode}/${record.systemId} ${classification.reason}。`,
    )
  }
}

export function retryReceiptBatch(
  state: WorkspaceState,
  batchIdValue: string,
  operator: string,
): WorkspaceState {
  const draft = cloneState(state)
  const batch = draft.receiptBatches.find((item) => item.id === batchIdValue)
  if (!batch) throw new Error('回执批次不存在')
  if (!batch.items.some((item) => item.status === 'failed')) {
    throw new Error('该批次没有断点失败条目，无需重试')
  }

  batch.attempts += 1
  const prepared: PreparedItem[] = batch.items.map((item) => ({
    requestCode: item.requestCode,
    systemId: item.systemId,
    result: item.result,
    executedAt: item.executedAt,
    receiptRef: item.receiptRef,
    message: item.message,
    fingerprint: item.fingerprint,
  }))

  batch.items.forEach((record, index) => {
    if (record.status !== 'failed') return
    record.errorReason = ''
    processItem(draft, batch, record, prepared[index], operator)
  })

  refreshBatchStatus(batch)
  appendAudit(
    draft,
    undefined,
    '回执批次断点重试',
    operator,
    `批次 ${batch.batchCode} 第 ${batch.attempts} 次尝试，从断点恢复：${countSummary(batch)}。`,
  )
  draft.revision += 1
  return draft
}

export function resolveReceiptItem(
  state: WorkspaceState,
  batchIdValue: string,
  itemKeyValue: string,
  resolution: 'keep-existing' | 'accept-incoming',
  note: string,
  operator: string,
): WorkspaceState {
  const draft = cloneState(state)
  const batch = draft.receiptBatches.find((item) => item.id === batchIdValue)
  if (!batch) throw new Error('回执批次不存在')
  const record = batch.items.find((item) => item.id === itemKeyValue)
  if (!record) throw new Error('回执条目不存在')
  if (record.status !== 'conflict') throw new Error('该回执条目没有待选择的差异')

  const request = draft.requests.find((item) => item.id === record.matchedRequestId)
  const task = request?.tasks.find((item) => item.id === record.matchedTaskId)
  if (!request || !task) throw new Error('回执对应的请求任务已不存在')

  const marker = conflictMarker(batch.id, record.id)
  request.conflicts = request.conflicts.filter((conflict) => !conflict.startsWith(marker))
  record.diffs = []
  record.resolvedBy = operator
  record.resolvedAt = now()
  record.resolutionNote = note

  if (resolution === 'accept-incoming') {
    applyLedgerEntry(draft, request, task, batch, record, operator, true)
    record.status = 'accepted-incoming'
    appendAudit(
      draft,
      request,
      '人工采用新回执',
      operator,
      `批次 ${batch.batchCode} 回执 ${record.receiptRef}：${note}`,
    )
  } else {
    record.status = 'kept-existing'
    appendAudit(
      draft,
      request,
      '人工保留原执行记录',
      operator,
      `批次 ${batch.batchCode} 回执 ${record.receiptRef} 未覆盖旧记录：${note}`,
    )
  }

  recomputeRequestStatus(request)
  refreshBatchStatus(batch)
  draft.revision += 1
  return draft
}

export function resolveConcurrentBatch(
  state: WorkspaceState,
  batchIdValue: string,
  resolution: 'keep-first' | 'adopt',
  note: string,
  operator: string,
): WorkspaceState {
  const draft = cloneState(state)
  const batch = draft.receiptBatches.find((item) => item.id === batchIdValue)
  if (!batch) throw new Error('回执批次不存在')
  if (!batch.concurrent) throw new Error('该批次不是并发提交批次')

  const marker = batchMarker(batch.id)
  draft.requests.forEach((request) => {
    request.conflicts = request.conflicts.filter((conflict) => !conflict.includes(marker))
  })

  if (resolution === 'keep-first') {
    batch.items.forEach((item) => {
      if (item.status === 'pending') {
        item.status = 'duplicate'
        item.processedAt = now()
      }
    })
    appendAudit(
      draft,
      undefined,
      '并发回执沿用首批',
      operator,
      `批次 ${batch.batchCode}：${note}；后到提交未写入，沿用先到者结果。`,
    )
  } else {
    batch.concurrent = false
    const prepared: PreparedItem[] = batch.items.map((item) => ({
      requestCode: item.requestCode,
      systemId: item.systemId,
      result: item.result,
      executedAt: item.executedAt,
      receiptRef: item.receiptRef,
      message: item.message,
      fingerprint: item.fingerprint,
    }))
    batch.items.forEach((record, index) => {
      if (record.status !== 'pending') return
      record.diffs = []
      record.errorReason = ''
      processItem(draft, batch, record, prepared[index], operator)
    })
    appendAudit(
      draft,
      undefined,
      '并发回执人工采用后到批次',
      operator,
      `批次 ${batch.batchCode}：${note}；差异已逐条按人工选择入账。`,
    )
  }

  batch.resolvedBy = operator
  batch.resolvedAt = now()
  batch.resolutionNote = note
  refreshBatchStatus(batch)
  draft.requests.forEach((request) => recomputeRequestStatus(request))
  draft.revision += 1
  return draft
}
