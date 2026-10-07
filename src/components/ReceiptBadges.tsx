import { Badge } from '@chakra-ui/react'
import {
  receiptBatchStatusLabels,
  receiptItemStatusLabels,
  receiptResultLabels,
  type ReceiptBatchStatus,
  type ReceiptItemStatus,
  type ReceiptResult,
} from '@/lib/schemas'

const itemColor: Record<ReceiptItemStatus, string> = {
  applied: 'green',
  duplicate: 'gray',
  conflict: 'red',
  failed: 'orange',
  pending: 'yellow',
  'kept-existing': 'teal',
  'accepted-incoming': 'blue',
}

const batchColor: Record<ReceiptBatchStatus, string> = {
  applied: 'green',
  partial: 'orange',
  'review-required': 'red',
  duplicate: 'gray',
}

const resultColor: Record<ReceiptResult, string> = {
  executed: 'green',
  rejected: 'red',
  partial: 'orange',
}

export function ReceiptItemStatusBadge({ status }: { status: ReceiptItemStatus }) {
  return <Badge colorScheme={itemColor[status]}>{receiptItemStatusLabels[status]}</Badge>
}

export function ReceiptBatchStatusBadge({ status }: { status: ReceiptBatchStatus }) {
  return <Badge colorScheme={batchColor[status]}>{receiptBatchStatusLabels[status]}</Badge>
}

export function ReceiptResultBadge({ result }: { result: ReceiptResult }) {
  return <Badge colorScheme={resultColor[result]}>{receiptResultLabels[result]}</Badge>
}
