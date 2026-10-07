import { z } from 'zod'

export const requestTypeSchema = z.enum([
  'access',
  'rectification',
  'deletion',
  'withdraw-consent',
  'restriction',
])

export const requestStatusSchema = z.enum([
  'registered',
  'identity-review',
  'processing',
  'review-required',
  'pending-close',
  'completed',
  'rejected',
  'extended',
])

export const regionSchema = z.enum(['cn', 'eu', 'us', 'sg'])

export const identitySchema = z.object({
  status: z.enum(['pending', 'verified', 'insufficient']),
  materialType: z.enum(['masked-id', 'account-ownership', 'authorization-letter', 'none']),
  maskedReference: z.string(),
  protectedDigest: z.string(),
  note: z.string(),
  reviewedAt: z.string().optional(),
})

export const workflowStepSchema = z.object({
  id: z.string(),
  order: z.number(),
  name: z.string(),
  role: z.string(),
  systemId: z.string().optional(),
  status: z.enum(['pending', 'active', 'completed', 'blocked']),
  assignee: z.string(),
  dueAt: z.string(),
  completedAt: z.string().optional(),
  exceptionReason: z.string(),
})

export const evidenceSchema = z.object({
  id: z.string(),
  stepId: z.string(),
  name: z.string(),
  evidenceType: z.enum(['execution-log', 'screenshot', 'signed-record', 'system-response']),
  digest: z.string(),
  uploadedBy: z.string(),
  uploadedAt: z.string(),
  protected: z.literal(true),
  source: z.enum(['manual', 'partner-receipt']).optional(),
  receiptBatchId: z.string().optional(),
  receiptItemId: z.string().optional(),
  superseded: z.boolean().optional(),
})

export const commentSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  author: z.string(),
  content: z.string(),
  createdAt: z.string(),
})

export const auditEntrySchema = z.object({
  id: z.string(),
  requestId: z.string().optional(),
  action: z.string(),
  operator: z.string(),
  detail: z.string(),
  createdAt: z.string(),
})

export const dataSystemSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.string(),
  dataDomain: z.string(),
  transferMethod: z.string(),
  slaDays: z.number(),
  requestTypes: z.array(requestTypeSchema),
  status: z.enum(['active', 'maintenance', 'retired']),
})

export const receiptItemStatusSchema = z.enum([
  'pending',
  'applied',
  'review-precondition',
  'review-diff',
  'review-concurrent',
  'review-unmatched',
  'duplicate-reuse',
  'kept-existing',
  'adopted-receipt',
])

export const receiptBatchStatusSchema = z.enum([
  'processing',
  'applied',
  'review-required',
  'partial-failed',
  'duplicate',
])

export const receiptFieldDiffSchema = z.object({
  field: z.string(),
  existing: z.string(),
  incoming: z.string(),
})

export const receiptItemSchema = z.object({
  id: z.string(),
  lineNo: z.number(),
  receiptRef: z.string(),
  fingerprint: z.string(),
  partnerRef: z.string(),
  requestId: z.string().optional(),
  requestCode: z.string(),
  systemId: z.string().optional(),
  systemName: z.string(),
  executedAt: z.string(),
  outcome: z.enum(['completed', 'partial', 'failed']),
  resultSummary: z.string(),
  status: receiptItemStatusSchema,
  taskId: z.string().optional(),
  evidenceId: z.string().optional(),
  reusedFromBatchId: z.string().optional(),
  reusedFromItemId: z.string().optional(),
  reviewReason: z.string(),
  diffs: z.array(receiptFieldDiffSchema),
  decidedBy: z.string().optional(),
  decidedAt: z.string().optional(),
  decisionNote: z.string(),
  processedAt: z.string().optional(),
})

export const receiptBatchSchema = z.object({
  id: z.string(),
  externalBatchId: z.string(),
  partnerName: z.string(),
  receivedAt: z.string(),
  importedAt: z.string(),
  importedBy: z.string(),
  clientToken: z.string(),
  payloadDigest: z.string(),
  status: receiptBatchStatusSchema,
  failureReason: z.string(),
  checkpointIndex: z.number(),
  totalLines: z.number(),
  items: z.array(receiptItemSchema),
  reimports: z
    .array(z.object({ clientToken: z.string(), at: z.string(), operator: z.string() }))
    .optional(),
})

export const privacyRequestSchema = z.object({
  id: z.string(),
  code: z.string(),
  requesterName: z.string(),
  requesterContact: z.string(),
  region: regionSchema,
  type: requestTypeSchema,
  status: requestStatusSchema,
  identity: identitySchema,
  requestedAt: z.string(),
  dueAt: z.string(),
  extendedDays: z.number(),
  duplicateOf: z.string().optional(),
  affectedSystemIds: z.array(z.string()),
  tasks: z.array(workflowStepSchema),
  evidence: z.array(evidenceSchema),
  conflicts: z.array(z.string()),
  resultSummary: z.string(),
  closureReason: z.string(),
  audit: z.array(
    auditEntrySchema.omit({ requestId: true }),
  ),
})

export const workspaceStateSchema = z.object({
  requests: z.array(privacyRequestSchema),
  systems: z.array(dataSystemSchema),
  comments: z.array(commentSchema),
  audit: z.array(auditEntrySchema),
  receiptBatches: z.array(receiptBatchSchema).default([]),
  revision: z.number(),
})

export const saveRequestInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  patch: privacyRequestSchema.partial(),
  operator: z.string().default('当前用户'),
})

export const createRequestInputSchema = z.object({
  state: workspaceStateSchema,
  input: z.object({
    requesterName: z.string().min(2),
    requesterContact: z.string().min(5),
    region: regionSchema,
    type: requestTypeSchema,
    affectedSystemIds: z.array(z.string()).min(1),
    identityMaterialType: identitySchema.shape.materialType,
    identityReference: z.string(),
    note: z.string(),
  }),
  operator: z.string().default('客服专员'),
})

export const identityInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  status: z.enum(['verified', 'insufficient']),
  note: z.string(),
  operator: z.string(),
})

export const assignTaskInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  taskId: z.string(),
  assignee: z.string().min(2),
  operator: z.string(),
})

export const taskActionInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  taskId: z.string(),
  action: z.enum(['start', 'complete', 'block']),
  note: z.string(),
  operator: z.string(),
})

export const evidenceInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  taskId: z.string(),
  name: z.string().min(2),
  evidenceType: evidenceSchema.shape.evidenceType,
  operator: z.string(),
})

export const conflictInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  conflict: z.string().min(4),
  operator: z.string(),
})

export const resolveConflictInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  conflictIndex: z.number().int().nonnegative(),
  resolution: z.string().min(4),
  operator: z.string(),
})

export const closeRequestInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  resultSummary: z.string().min(4),
  closureReason: z.string(),
  operator: z.string(),
})

export const extendRequestInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  days: z.number().int().min(1).max(90),
  reason: z.string().min(4),
  operator: z.string(),
})

export const commentInputSchema = z.object({
  state: workspaceStateSchema,
  requestId: z.string(),
  content: z.string().min(2),
  operator: z.string(),
})

export const recordExportInputSchema = z.object({
  state: workspaceStateSchema,
  scope: z.string(),
  count: z.number().int().nonnegative(),
  operator: z.string(),
})

export const receiptLineInputSchema = z.object({
  requestCode: z.string().min(3),
  systemName: z.string().min(2),
  executedAt: z.string().min(8),
  outcome: z.enum(['completed', 'partial', 'failed']),
  resultSummary: z.string().min(2),
  receiptRef: z.string().min(2),
})

export const importReceiptBatchInputSchema = z.object({
  state: workspaceStateSchema,
  clientToken: z.string().min(8),
  externalBatchId: z.string().min(2),
  partnerName: z.string().min(2),
  receivedAt: z.string().min(8),
  lines: z.array(receiptLineInputSchema).min(1),
  failAfter: z.number().int().nonnegative().optional(),
  operator: z.string(),
})

export const retryReceiptBatchInputSchema = z.object({
  state: workspaceStateSchema,
  batchId: z.string(),
  failAfter: z.number().int().nonnegative().optional(),
  operator: z.string(),
})

export const receiptDecisionInputSchema = z.object({
  state: workspaceStateSchema,
  batchId: z.string(),
  itemId: z.string(),
  choice: z.enum(['keep-existing', 'adopt-receipt']),
  note: z.string().min(2),
  operator: z.string(),
})

export const dismissReceiptItemInputSchema = z.object({
  state: workspaceStateSchema,
  batchId: z.string(),
  itemId: z.string(),
  note: z.string().min(2),
  operator: z.string(),
})

export type RequestType = z.infer<typeof requestTypeSchema>
export type RequestStatus = z.infer<typeof requestStatusSchema>
export type Region = z.infer<typeof regionSchema>
export type IdentityCheck = z.infer<typeof identitySchema>
export type WorkflowStep = z.infer<typeof workflowStepSchema>
export type ExecutionEvidence = z.infer<typeof evidenceSchema>
export type ReviewComment = z.infer<typeof commentSchema>
export type AuditEntry = z.infer<typeof auditEntrySchema>
export type DataSystem = z.infer<typeof dataSystemSchema>
export type PrivacyRequest = z.infer<typeof privacyRequestSchema>
export type ReceiptItem = z.infer<typeof receiptItemSchema>
export type ReceiptBatch = z.infer<typeof receiptBatchSchema>
export type ReceiptItemStatus = z.infer<typeof receiptItemStatusSchema>
export type ReceiptBatchStatus = z.infer<typeof receiptBatchStatusSchema>
export type ReceiptFieldDiff = z.infer<typeof receiptFieldDiffSchema>
export type WorkspaceState = z.infer<typeof workspaceStateSchema>

export const requestTypeLabels: Record<RequestType, string> = {
  access: '访问',
  rectification: '更正',
  deletion: '删除',
  'withdraw-consent': '撤回同意',
  restriction: '限制处理',
}

export const requestStatusLabels: Record<RequestStatus, string> = {
  registered: '已登记',
  'identity-review': '身份核验中',
  processing: '履约处理中',
  'review-required': '复核队列',
  'pending-close': '待关闭',
  completed: '已完成',
  rejected: '已拒绝',
  extended: '已延期',
}

export const regionLabels: Record<Region, string> = {
  cn: '中国大陆',
  eu: '欧盟',
  us: '美国加州',
  sg: '新加坡',
}

export const systemStatusLabels: Record<DataSystem['status'], string> = {
  active: '在用',
  maintenance: '维护中',
  retired: '已退役',
}

export const receiptBatchStatusLabels: Record<ReceiptBatchStatus, string> = {
  processing: '写入中断',
  applied: '已对账',
  'review-required': '待复核',
  'partial-failed': '部分失败待重试',
  duplicate: '重复导入沿用原结果',
}

export const receiptItemStatusLabels: Record<ReceiptItemStatus, string> = {
  pending: '待写入',
  applied: '已对账写入',
  'review-precondition': '复核：前置条件不满足',
  'review-diff': '复核：与既有结果有差异',
  'review-concurrent': '复核：同批次并发提交',
  'review-unmatched': '复核：未匹配任务',
  'duplicate-reuse': '重复导入沿用原结果',
  'kept-existing': '人工保留既有记录',
  'adopted-receipt': '人工采用回执结果',
}

export const receiptOutcomeLabels = {
  completed: '已执行',
  partial: '部分执行',
  failed: '执行失败',
} as const
