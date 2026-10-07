import { TRPCError, initTRPC } from '@trpc/server'
import {
  addComment,
  addConflict,
  addEvidence,
  assignTask,
  closeRequest,
  createRequest,
  extendRequest,
  recordExport,
  resolveConflict,
  saveRequest,
  taskAction,
  verifyIdentity,
} from '@/services/requestService'
import {
  importReceipts,
  resolveConcurrentBatch,
  resolveReceiptItem,
  retryReceiptBatch,
} from '@/services/receiptService'
import { createInitialState } from '@/services/mockData'
import {
  assignTaskInputSchema,
  closeRequestInputSchema,
  commentInputSchema,
  conflictInputSchema,
  createRequestInputSchema,
  evidenceInputSchema,
  extendRequestInputSchema,
  identityInputSchema,
  importReceiptsInputSchema,
  recordExportInputSchema,
  resolveConcurrentBatchInputSchema,
  resolveConflictInputSchema,
  resolveReceiptItemInputSchema,
  retryReceiptBatchInputSchema,
  saveRequestInputSchema,
  taskActionInputSchema,
} from '@/lib/schemas'
import type { WorkspaceState } from '@/types/domain'

const t = initTRPC.create()
const publicProcedure = t.procedure

function execute(operation: () => WorkspaceState): WorkspaceState {
  try {
    return operation()
  } catch (error) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: error instanceof Error ? error.message : '请求处理失败',
    })
  }
}

export const appRouter = t.router({
  workspace: t.router({
    defaults: publicProcedure.query(() => createInitialState()),
  }),
  request: t.router({
    create: publicProcedure
      .input(createRequestInputSchema)
      .mutation(({ input }) =>
        execute(() => createRequest(input.state, input.input, input.operator)),
      ),
    save: publicProcedure
      .input(saveRequestInputSchema)
      .mutation(({ input }) =>
        execute(() => saveRequest(input.state, input.requestId, input.patch, input.operator)),
      ),
    verifyIdentity: publicProcedure
      .input(identityInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          verifyIdentity(input.state, input.requestId, input.status, input.note, input.operator),
        ),
      ),
    assignTask: publicProcedure
      .input(assignTaskInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          assignTask(
            input.state,
            input.requestId,
            input.taskId,
            input.assignee,
            input.operator,
          ),
        ),
      ),
    taskAction: publicProcedure
      .input(taskActionInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          taskAction(
            input.state,
            input.requestId,
            input.taskId,
            input.action,
            input.note,
            input.operator,
          ),
        ),
      ),
    addEvidence: publicProcedure
      .input(evidenceInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          addEvidence(
            input.state,
            input.requestId,
            input.taskId,
            input.name,
            input.evidenceType,
            input.operator,
          ),
        ),
      ),
    addConflict: publicProcedure
      .input(conflictInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          addConflict(input.state, input.requestId, input.conflict, input.operator),
        ),
      ),
    resolveConflict: publicProcedure
      .input(resolveConflictInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          resolveConflict(
            input.state,
            input.requestId,
            input.conflictIndex,
            input.resolution,
            input.operator,
          ),
        ),
      ),
    extend: publicProcedure
      .input(extendRequestInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          extendRequest(
            input.state,
            input.requestId,
            input.days,
            input.reason,
            input.operator,
          ),
        ),
      ),
    close: publicProcedure
      .input(closeRequestInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          closeRequest(
            input.state,
            input.requestId,
            input.resultSummary,
            input.closureReason,
            input.operator,
          ),
        ),
      ),
    comment: publicProcedure
      .input(commentInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          addComment(input.state, input.requestId, input.content, input.operator),
        ),
      ),
    recordExport: publicProcedure
      .input(recordExportInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          recordExport(input.state, input.scope, input.count, input.operator),
        ),
      ),
  }),
  receipt: t.router({
    import: publicProcedure
      .input(importReceiptsInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          importReceipts(input.state, {
            batchCode: input.batchCode,
            source: input.source,
            operator: input.operator,
            failAt: input.failAt,
            items: input.items,
          }),
        ),
      ),
    retry: publicProcedure
      .input(retryReceiptBatchInputSchema)
      .mutation(({ input }) =>
        execute(() => retryReceiptBatch(input.state, input.batchId, input.operator)),
      ),
    resolveItem: publicProcedure
      .input(resolveReceiptItemInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          resolveReceiptItem(
            input.state,
            input.batchId,
            input.itemId,
            input.resolution,
            input.note,
            input.operator,
          ),
        ),
      ),
    resolveConcurrent: publicProcedure
      .input(resolveConcurrentBatchInputSchema)
      .mutation(({ input }) =>
        execute(() =>
          resolveConcurrentBatch(
            input.state,
            input.batchId,
            input.resolution,
            input.note,
            input.operator,
          ),
        ),
      ),
  }),
})

export type AppRouter = typeof appRouter
