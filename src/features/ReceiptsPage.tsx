'use client'

import { useMemo, useState } from 'react'
import NextLink from 'next/link'
import {
  Alert,
  Badge,
  Box,
  Button,
  Collapse,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  SimpleGrid,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Textarea,
  Th,
  Thead,
  Tr,
  VStack,
  useDisclosure,
  useToast,
} from '@chakra-ui/react'
import { Inbox, Play, RefreshCw, Scale } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import {
  useDecideReceiptItemMutation,
  useDismissReceiptItemMutation,
  useImportReceiptBatchMutation,
  useRetryReceiptBatchMutation,
  useWorkspaceQuery,
} from '@/lib/hooks'
import { getClientToken } from '@/lib/session'
import {
  receiptBatchStatusLabels,
  receiptItemStatusLabels,
  receiptOutcomeLabels,
  type ReceiptBatch,
  type ReceiptItem,
} from '@/lib/schemas'
import { batchRequestSummary } from '@/services/receiptService'

const batchBadgeColor: Record<ReceiptBatch['status'], string> = {
  processing: 'orange',
  applied: 'green',
  'review-required': 'red',
  'partial-failed': 'orange',
  duplicate: 'gray',
}

const itemBadgeColor: Record<ReceiptItem['status'], string> = {
  pending: 'gray',
  applied: 'green',
  'review-precondition': 'red',
  'review-diff': 'red',
  'review-concurrent': 'orange',
  'review-unmatched': 'red',
  'duplicate-reuse': 'blue',
  'kept-existing': 'gray',
  'adopted-receipt': 'teal',
}

const SAMPLE_LINES = `DSR-2026-001,客户关系管理系统,2026-10-02T09:00:00Z,completed,客户主档访问请求已执行并导出脱敏副本,RC-7701
DSR-2026-001,订单与交易平台,2026-10-02T10:30:00Z,partial,订单数据仅完成近 12 个月范围导出,RC-7702
DSR-2026-001,客服工单系统,2026-10-03T03:20:00Z,failed,工单附件区因权限维护暂时无法导出,RC-7703
DSR-2026-004,营销自动化平台,2026-10-02T08:15:00Z,completed,同意状态已撤回且触达任务已停止,RC-7704`

const REVIEW_STATUSES: ReceiptItem['status'][] = [
  'review-precondition',
  'review-diff',
  'review-concurrent',
  'review-unmatched',
]

function parseLines(raw: string) {
  const rows = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(',').map((cell) => cell.trim()))
  return rows.map(([requestCode, systemName, executedAt, outcome, resultSummary, receiptRef]) => ({
    requestCode: requestCode ?? '',
    systemName: systemName ?? '',
    executedAt: executedAt ?? '',
    outcome: (['completed', 'partial', 'failed'].includes(outcome ?? '')
      ? outcome
      : 'completed') as ReceiptItem['outcome'],
    resultSummary: resultSummary ?? '',
    receiptRef: receiptRef ?? '',
  }))
}

export function ReceiptsPage() {
  const toast = useToast()
  const { data, isLoading } = useWorkspaceQuery()
  const importBatch = useImportReceiptBatchMutation()
  const retryBatch = useRetryReceiptBatchMutation()
  const decideItem = useDecideReceiptItemMutation()
  const dismissItem = useDismissReceiptItemMutation()
  const { isOpen, onOpen, onClose } = useDisclosure()

  const [externalBatchId, setExternalBatchId] = useState('')
  const [partnerName, setPartnerName] = useState('合作方离线通道')
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 16))
  const [rawLines, setRawLines] = useState(SAMPLE_LINES)
  const [simulateOtherWindow, setSimulateOtherWindow] = useState(false)
  const [failAfter, setFailAfter] = useState(0)
  const [expandedBatchId, setExpandedBatchId] = useState('')
  const [reviewTarget, setReviewTarget] = useState<{ batch: ReceiptBatch; item: ReceiptItem }>()
  const [reviewChoice, setReviewChoice] = useState<'keep-existing' | 'adopt-receipt'>('keep-existing')
  const [reviewNote, setReviewNote] = useState('')

  const clientToken = getClientToken()

  const stats = useMemo(() => {
    const batches = data?.receiptBatches ?? []
    const items = batches.flatMap((batch) => batch.items)
    return {
      batches: batches.length,
      pendingRetry: batches.filter((batch) => batch.status === 'partial-failed').length,
      review: items.filter((item) => REVIEW_STATUSES.includes(item.status)).length,
      reused: items.filter((item) => item.status === 'duplicate-reuse').length,
    }
  }, [data])

  if (isLoading || !data) return <Box className="panel">正在加载回执批次...</Box>

  function resetImportForm() {
    setExternalBatchId('')
    setRawLines(SAMPLE_LINES)
    setSimulateOtherWindow(false)
    setFailAfter(0)
  }

  async function submitImport() {
    const lines = parseLines(rawLines)
    if (!externalBatchId.trim()) {
      toast({ title: '请填写合作方批次号', status: 'warning' })
      return
    }
    if (!lines.length) {
      toast({ title: '请至少填写一条回执', status: 'warning' })
      return
    }
    const invalid = lines.find(
      (line) =>
        !line.requestCode || !line.systemName || !line.executedAt || !line.resultSummary || !line.receiptRef,
    )
    if (invalid) {
      toast({ title: '回执字段不完整', description: '每行需含 6 列，用英文逗号分隔。', status: 'error' })
      return
    }
    try {
      const result = await importBatch.mutateAsync({
        clientToken: simulateOtherWindow ? `${clientToken}-other-window` : clientToken,
        externalBatchId: externalBatchId.trim(),
        partnerName: partnerName.trim(),
        receivedAt: new Date(receivedAt).toISOString(),
        lines,
        failAfter: failAfter > 0 ? failAfter : undefined,
        operator: '客服专员',
      })
      const batch = result.receiptBatches.find((item) => item.externalBatchId === externalBatchId.trim())
      setExpandedBatchId(batch?.id ?? result.receiptBatches[0]?.id ?? '')
      toast({
        title:
          batch?.status === 'partial-failed'
            ? '批次部分写入，已保留完成部分'
            : batch?.status === 'review-required'
              ? '批次进入复核'
              : '回执批次对账完成',
        description: batch?.failureReason || undefined,
        status: batch?.status === 'applied' ? 'success' : 'warning',
      })
      resetImportForm()
      onClose()
    } catch (error) {
      toast({
        title: '批次导入失败',
        description: error instanceof Error ? error.message : '请检查回执内容',
        status: 'error',
      })
    }
  }

  async function submitReview() {
    if (!reviewTarget) return
    try {
      if (reviewTarget.item.status === 'review-diff' || reviewTarget.item.status === 'review-concurrent') {
        await decideItem.mutateAsync({
          batchId: reviewTarget.batch.id,
          itemId: reviewTarget.item.id,
          choice: reviewChoice,
          note: reviewNote,
          operator: '隐私负责人',
        })
      } else {
        await dismissItem.mutateAsync({
          batchId: reviewTarget.batch.id,
          itemId: reviewTarget.item.id,
          note: reviewNote,
          operator: '隐私负责人',
        })
      }
      toast({ title: '复核结论已记录', status: 'success' })
      setReviewTarget(undefined)
      setReviewNote('')
    } catch (error) {
      toast({
        title: '复核提交失败',
        description: error instanceof Error ? error.message : '请检查输入',
        status: 'error',
      })
    }
  }

  return (
    <Box>
      <PageHeader
        title="合作方回执批次对账"
        description="离线带回的系统回执按系统任务匹配隐私请求；同一回执沿用原结果，重复导入不重复生成证据、审计或延期。"
        actions={
          <Button colorScheme="brand" leftIcon={<Inbox size={16} />} onClick={onOpen}>
            导入回执批次
          </Button>
        }
      />

      <Alert status="info" mb="4" borderRadius="5px">
        写入失败时保留已完成部分并可断点重试；同批次并发提交时先到者写入、后到者进入复核；回执与既有执行结果不一致时只列差异，由人工选择保留或采用，绝不静默覆盖。
      </Alert>

      <SimpleGrid columns={4} spacing="4" mb="5">
        <Box className="metric info">
          <Text color="gray.600" fontSize="sm">回执批次</Text>
          <Heading mt="2" size="md">{stats.batches}</Heading>
        </Box>
        <Box className="metric warning">
          <Text color="gray.600" fontSize="sm">写入中断待重试</Text>
          <Heading mt="2" size="md">{stats.pendingRetry}</Heading>
        </Box>
        <Box className="metric danger">
          <Text color="gray.600" fontSize="sm">差异/并发待复核</Text>
          <Heading mt="2" size="md">{stats.review}</Heading>
        </Box>
        <Box className="metric">
          <Text color="gray.600" fontSize="sm">重复导入沿用原结果</Text>
          <Heading mt="2" size="md">{stats.reused}</Heading>
        </Box>
      </SimpleGrid>

      {!data.receiptBatches.length ? (
        <Box className="panel">
          <VStack spacing="2" py="6">
            <Inbox size={36} color="#8aa0ad" />
            <Text fontWeight="600">还没有导入过回执批次</Text>
            <Text color="gray.500" fontSize="sm">
              可使用导入框中的示例回执：其中包含正常执行、部分执行、执行失败，以及与 DSR-2026-004 既有结果冲突的行。
            </Text>
          </VStack>
        </Box>
      ) : null}

      <VStack align="stretch" spacing="4">
        {data.receiptBatches.map((batch) => {
          const expanded = expandedBatchId === batch.id
          const summary = batchRequestSummary(batch)
          const reviewCount = batch.items.filter((item) => REVIEW_STATUSES.includes(item.status)).length
          const pendingCount = batch.items.filter((item) => item.status === 'pending').length
          const appliedCount = batch.items.filter((item) =>
            ['applied', 'adopted-receipt', 'kept-existing', 'duplicate-reuse'].includes(item.status),
          ).length
          return (
            <Box key={batch.id} className="panel">
              <Flex justify="space-between" align="center" gap="4" wrap="wrap">
                <Box>
                  <HStack mb="1">
                    <Heading size="sm">批次 {batch.externalBatchId}</Heading>
                    <Badge colorScheme={batchBadgeColor[batch.status]}>
                      {receiptBatchStatusLabels[batch.status]}
                    </Badge>
                    {batch.reimports?.length ? (
                      <Badge colorScheme="blue">重复导入 ×{batch.reimports.length}（沿用原结果）</Badge>
                    ) : null}
                  </HStack>
                  <Text color="gray.500" fontSize="xs">
                    {batch.partnerName} · 离线带回 {new Date(batch.receivedAt).toLocaleString('zh-CN')} ·
                    导入 {new Date(batch.importedAt).toLocaleString('zh-CN')} · {batch.importedBy} ·
                    窗口 {batch.clientToken.slice(0, 8)}
                  </Text>
                </Box>
                <HStack>
                  <Text fontSize="sm" color="gray.600">
                    已处理 {appliedCount}/{batch.items.length}
                    {reviewCount ? ` · 待复核 ${reviewCount}` : ''}
                    {pendingCount ? ` · 待写入 ${pendingCount}` : ''}
                  </Text>
                  <Button size="xs" variant="outline" onClick={() => setExpandedBatchId(expanded ? '' : batch.id)}>
                    {expanded ? '收起明细' : '展开明细'}
                  </Button>
                  {batch.status === 'partial-failed' ? (
                    <Button
                      size="xs"
                      colorScheme="orange"
                      leftIcon={<RefreshCw size={13} />}
                      isLoading={retryBatch.isPending}
                      onClick={async () => {
                        try {
                          await retryBatch.mutateAsync({ batchId: batch.id, operator: '客服专员' })
                          toast({ title: '已从断点恢复并处理剩余回执', status: 'success' })
                        } catch (error) {
                          toast({
                            title: '断点重试失败',
                            description: error instanceof Error ? error.message : '请稍后重试',
                            status: 'error',
                          })
                        }
                      }}
                    >
                      断点重试（第 {batch.checkpointIndex + 1} 行起）
                    </Button>
                  ) : null}
                </HStack>
              </Flex>

              {batch.failureReason ? (
                <Alert status="warning" mt="3" borderRadius="5px" fontSize="sm">
                  {batch.failureReason}
                </Alert>
              ) : null}

              <HStack mt="3" wrap="wrap">
                {summary.map((group) => {
                  const request = data.requests.find((item) => item.code === group.code)
                  return (
                    <NextLink key={group.code} href={request ? `/requests/${request.id}` : '#'}>
                      <Badge
                        colorScheme={request ? 'brand' : 'red'}
                        variant="outline"
                        p="1"
                        px="2"
                      >
                        {group.code}：写入 {group.applied}
                        {group.review ? ` · 复核 ${group.review}` : ''}
                        {group.duplicate ? ` · 沿用 ${group.duplicate}` : ''}
                        {!request ? ' · 请求不存在' : ''}
                      </Badge>
                    </NextLink>
                  )
                })}
              </HStack>

              <Collapse in={expanded} animateOpacity>
                <TableContainer mt="3">
                  <Table size="sm">
                    <Thead>
                      <Tr>
                        <Th w="42px">#</Th>
                        <Th>请求 / 系统</Th>
                        <Th>回执结论</Th>
                        <Th>执行时间</Th>
                        <Th>对账状态</Th>
                        <Th w="120px">操作</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {batch.items.map((item) => (
                        <Tr key={item.id}>
                          <Td color="gray.500">{item.lineNo}</Td>
                          <Td>
                            <Text fontWeight="600">{item.requestCode}</Text>
                            <Text color="gray.500" fontSize="xs">
                              {item.systemName} · {item.receiptRef}
                            </Text>
                          </Td>
                          <Td>
                            <Badge
                              colorScheme={
                                item.outcome === 'completed'
                                  ? 'green'
                                  : item.outcome === 'partial'
                                    ? 'orange'
                                    : 'red'
                              }
                            >
                              {receiptOutcomeLabels[item.outcome]}
                            </Badge>
                            <Text mt="1" fontSize="xs" color="gray.600" maxW="320px">
                              {item.resultSummary}
                            </Text>
                          </Td>
                          <Td whiteSpace="nowrap" fontSize="xs">
                            {new Date(item.executedAt).toLocaleString('zh-CN')}
                          </Td>
                          <Td>
                            <Badge colorScheme={itemBadgeColor[item.status]}>
                              {receiptItemStatusLabels[item.status]}
                            </Badge>
                            {item.reusedFromBatchId ? (
                              <Text mt="1" fontSize="xs" color="blue.600">
                                沿用原证据与审计，未重复生成
                              </Text>
                            ) : null}
                            {item.reviewReason ? (
                              <Text mt="1" fontSize="xs" color="red.600" maxW="280px">
                                {item.reviewReason}
                              </Text>
                            ) : null}
                            {item.decisionNote ? (
                              <Text mt="1" fontSize="xs" color="gray.500">
                                人工结论：{item.decisionNote}（{item.decidedBy}）
                              </Text>
                            ) : null}
                          </Td>
                          <Td>
                            {REVIEW_STATUSES.includes(item.status) ? (
                              <Button
                                size="xs"
                                colorScheme="red"
                                variant="outline"
                                leftIcon={<Scale size={12} />}
                                onClick={() => {
                                  setReviewTarget({ batch, item })
                                  setReviewChoice('keep-existing')
                                  setReviewNote('')
                                }}
                              >
                                差异复核
                              </Button>
                            ) : item.status === 'pending' ? (
                              <Button
                                size="xs"
                                colorScheme="orange"
                                variant="outline"
                                leftIcon={<Play size={12} />}
                                isLoading={retryBatch.isPending}
                                onClick={() =>
                                  retryBatch
                                    .mutateAsync({ batchId: batch.id, operator: '客服专员' })
                                    .then(() => toast({ title: '断点已恢复', status: 'success' }))
                                    .catch((error: Error) =>
                                      toast({ title: '重试失败', description: error.message, status: 'error' }),
                                    )
                                }
                              >
                                恢复写入
                              </Button>
                            ) : null}
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </TableContainer>
              </Collapse>
            </Box>
          )
        })}
      </VStack>

      <Modal isOpen={isOpen} onClose={onClose} size="2xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>导入合作方离线回执批次</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack align="stretch" spacing="4">
              <SimpleGrid columns={2} spacing="4">
                <FormControl isRequired>
                  <FormLabel>合作方批次号</FormLabel>
                  <Input
                    value={externalBatchId}
                    onChange={(event) => setExternalBatchId(event.target.value)}
                    placeholder="例如 RC-BATCH-20261007-01"
                  />
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>合作方 / 通道</FormLabel>
                  <Input value={partnerName} onChange={(event) => setPartnerName(event.target.value)} />
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>离线带回时间</FormLabel>
                  <Input
                    type="datetime-local"
                    value={receivedAt}
                    onChange={(event) => setReceivedAt(event.target.value)}
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>写入失败模拟（0 = 不失败）</FormLabel>
                  <Input
                    type="number"
                    min={0}
                    value={failAfter}
                    onChange={(event) => setFailAfter(Number(event.target.value))}
                  />
                </FormControl>
              </SimpleGrid>
              <FormControl>
                <FormLabel>
                  回执内容（每行：请求编号,系统名称,执行时间,completed/partial/failed,执行结果,回执流水号）
                </FormLabel>
                <Textarea
                  value={rawLines}
                  onChange={(event) => setRawLines(event.target.value)}
                  fontFamily="mono"
                  fontSize="xs"
                  minH="150px"
                />
              </FormControl>
              <FormControl>
                <Select
                  value={simulateOtherWindow ? 'other' : 'self'}
                  onChange={(event) => setSimulateOtherWindow(event.target.value === 'other')}
                >
                  <option value="self">本窗口提交（窗口 {clientToken.slice(0, 8)}）</option>
                  <option value="other">模拟另一窗口同时提交同批次（先到者写入，后到者复核）</option>
                </Select>
              </FormControl>
              <Alert status="info" borderRadius="5px" fontSize="sm">
                重复提交相同批次号与内容会直接沿用原结果；可先在两个浏览器标签页各打开本页面验证并发行为。
              </Alert>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr="3" onClick={onClose}>取消</Button>
            <Button colorScheme="brand" isLoading={importBatch.isPending} onClick={submitImport}>
              对账并写入
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={Boolean(reviewTarget)}
        onClose={() => setReviewTarget(undefined)}
        size="xl"
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            {reviewTarget ? `回执差异复核 · ${reviewTarget.item.receiptRef}` : '回执差异复核'}
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {reviewTarget ? (
              <VStack align="stretch" spacing="4">
                <Alert status="warning" borderRadius="5px">
                  {reviewTarget.item.reviewReason}
                </Alert>
                <Box className="summary-box">
                  <Text fontWeight="600">
                    {reviewTarget.item.requestCode} · {reviewTarget.item.systemName}
                  </Text>
                  <Text mt="1" fontSize="sm">
                    回执结论：{receiptOutcomeLabels[reviewTarget.item.outcome]}；{reviewTarget.item.resultSummary}
                  </Text>
                </Box>
                {reviewTarget.item.diffs.length ? (
                  <TableContainer border="1px solid #e0e7ec" borderRadius="5px">
                    <Table size="sm">
                      <Thead>
                        <Tr>
                          <Th>差异项</Th>
                          <Th>既有记录（旧）</Th>
                          <Th>新回执</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {reviewTarget.item.diffs.map((diff) => (
                          <Tr key={diff.field}>
                            <Td fontWeight="600">{diff.field}</Td>
                            <Td color="gray.700">{diff.existing}</Td>
                            <Td color="red.700">{diff.incoming}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </TableContainer>
                ) : null}
                {reviewTarget.item.status === 'review-diff' ||
                reviewTarget.item.status === 'review-concurrent' ? (
                  <FormControl>
                    <FormLabel>人工选择</FormLabel>
                    <Select
                      value={reviewChoice}
                      onChange={(event) =>
                        setReviewChoice(event.target.value as 'keep-existing' | 'adopt-receipt')
                      }
                    >
                      <option value="keep-existing">保留既有记录（新回执不覆盖，仅留痕）</option>
                      <option value="adopt-receipt">采用新回执（旧证据标记替代、不物理删除）</option>
                    </Select>
                  </FormControl>
                ) : null}
                <FormControl isRequired>
                  <FormLabel>复核说明</FormLabel>
                  <Textarea
                    value={reviewNote}
                    onChange={(event) => setReviewNote(event.target.value)}
                    placeholder="说明人工判断依据，例如继续追办、以线下凭证为准等"
                  />
                </FormControl>
              </VStack>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr="3" onClick={() => setReviewTarget(undefined)}>
              取消
            </Button>
            <Button
              colorScheme="brand"
              isDisabled={!reviewNote.trim()}
              isLoading={decideItem.isPending || dismissItem.isPending}
              onClick={submitReview}
            >
              提交复核结论
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  )
}
