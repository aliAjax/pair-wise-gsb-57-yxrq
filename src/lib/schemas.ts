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

export const receiptResultSchema = z.enum(['executed', 'rejected', 'partial'])

export const receiptItemStatusSchema = z.enum([
  'pending',
  'applied',
  'duplicate',
  'conflict',
  'failed',
  'kept-existing',
  'accepted-incoming',
])

export const receiptBatchStatusSchema = z.enum(['applied', 'partial', 'review-required', 'duplicate'])

export const receiptResolutionSchema = z.enum(['keep-existing', 'accept-incoming'])

export const receiptDiffSchema = z.object({
  field: z.string(),
  label: z.string(),
  existing: z.string(),
  incoming: z.string(),
})

export const receiptItemSchema = z.object({
  id: z.string(),
  receiptRef: z.string(),
  requestCode: z.string(),
  systemId: z.string(),
  result: receiptResultSchema,
  executedAt: z.string(),
  message: z.string(),
  fingerprint: z.string(),
  status: receiptItemStatusSchema,
  matchedRequestId: z.string().optional(),
  matchedTaskId: z.string().optional(),
  diffs: z.array(receiptDiffSchema),
  errorReason: z.string(),
  processedAt: z.string().optional(),
  resolvedBy: z.string().optional(),
  resolvedAt: z.string().optional(),
  resolutionNote: z.string().optional(),
})

export const receiptBatchSchema = z.object({
  id: z.string(),
  batchCode: z.string(),
  source: z.string(),
  importedBy: z.string(),
  importedAt: z.string(),
  digest: z.string(),
  status: receiptBatchStatusSchema,
  concurrent: z.boolean(),
  concurrentOf: z.string().optional(),
  attempts: z.number(),
  lastAttemptAt: z.string(),
  items: z.array(receiptItemSchema),
  resolvedBy: z.string().optional(),
  resolvedAt: z.string().optional(),
  resolutionNote: z.string().optional(),
})

export const workspaceStateSchema = z.object({
  requests: z.array(privacyRequestSchema),
  systems: z.array(dataSystemSchema),
  comments: z.array(commentSchema),
  audit: z.array(auditEntrySchema),
  receiptBatches: z.array(receiptBatchSchema).default([]),
  revision: z.number(),
})

export const receiptItemInputSchema = z.object({
  requestCode: z.string().min(3),
  systemId: z.string().min(2),
  result: receiptResultSchema,
  executedAt: z.string(),
  receiptRef: z.string().min(2),
  message: z.string(),
})

export const importReceiptsInputSchema = z.object({
  state: workspaceStateSchema,
  batchCode: z.string().min(2),
  source: z.string().min(2),
  operator: z.string().default('客服专员'),
  failAt: z.number().int().min(-1).default(-1),
  items: z.array(receiptItemInputSchema).min(1),
})

export const retryReceiptBatchInputSchema = z.object({
  state: workspaceStateSchema,
  batchId: z.string(),
  operator: z.string(),
})

export const resolveReceiptItemInputSchema = z.object({
  state: workspaceStateSchema,
  batchId: z.string(),
  itemId: z.string(),
  resolution: receiptResolutionSchema,
  note: z.string().min(2),
  operator: z.string(),
})

export const resolveConcurrentBatchInputSchema = z.object({
  state: workspaceStateSchema,
  batchId: z.string(),
  resolution: z.enum(['keep-first', 'adopt']),
  note: z.string().min(2),
  operator: z.string(),
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
export type WorkspaceState = z.infer<typeof workspaceStateSchema>
export type ReceiptBatch = z.infer<typeof receiptBatchSchema>
export type ReceiptItem = z.infer<typeof receiptItemSchema>
export type ReceiptResult = z.infer<typeof receiptResultSchema>
export type ReceiptItemStatus = z.infer<typeof receiptItemStatusSchema>
export type ReceiptBatchStatus = z.infer<typeof receiptBatchStatusSchema>
export type ReceiptDiff = z.infer<typeof receiptDiffSchema>
export type ReceiptResolution = z.infer<typeof receiptResolutionSchema>

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

export const receiptResultLabels: Record<ReceiptResult, string> = {
  executed: '已执行',
  rejected: '拒绝执行',
  partial: '部分执行',
}

export const receiptItemStatusLabels: Record<ReceiptItemStatus, string> = {
  pending: '待写入',
  applied: '已对账写入',
  duplicate: '重复回执沿用原结果',
  conflict: '差异待人工选择',
  failed: '写入失败',
  'kept-existing': '人工保留原记录',
  'accepted-incoming': '人工采用新回执',
}

export const receiptBatchStatusLabels: Record<ReceiptBatchStatus, string> = {
  applied: '全部写入完成',
  partial: '断点保留·待重试',
  'review-required': '并发/差异复核中',
  duplicate: '重复批次未重复生成',
}
