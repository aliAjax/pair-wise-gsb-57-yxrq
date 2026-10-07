'use client'

import { useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Box,
  Button,
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
import { FileClock, Inbox, RefreshCw, Scale } from 'lucide-react'
import NextLink from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import {
  ReceiptBatchStatusBadge,
  ReceiptItemStatusBadge,
  ReceiptResultBadge,
} from '@/components/ReceiptBadges'
import {
  useImportReceiptsMutation,
  useResolveConcurrentBatchMutation,
  useResolveReceiptItemMutation,
  useRetryReceiptBatchMutation,
  useWorkspaceQuery,
} from '@/lib/hooks'
import {
  receiptResultLabels,
  type ReceiptBatch,
  type ReceiptItem,
  type ReceiptResult,
} from '@/lib/schemas'

interface DraftRow {
  requestCode: string
  systemId: string
  result: ReceiptResult
  executedAt: string
  receiptRef: string
  message: string
}

const emptyRow = (): DraftRow => ({
  requestCode: 'DSR-2026-001',
  systemId: 'sys-crm',
  result: 'executed',
  executedAt: new Date().toISOString().slice(0, 16),
  receiptRef: '',
  message: '',
})

const demoRows: DraftRow[] = [
  {
    requestCode: 'DSR-2026-001',
    systemId: 'sys-crm',
    result: 'executed',
    executedAt: '2026-10-07T09:00',
    receiptRef: 'R-CRM-1001',
    message: '访问数据包已生成并加密回传。',
  },
  {
    requestCode: 'DSR-2026-001',
    systemId: 'sys-order',
    result: 'executed',
    executedAt: '2026-10-07T09:20',
    receiptRef: 'R-ORD-2207',
    message: '订单数据导出完成。',
  },
  {
    requestCode: 'DSR-2026-001',
    systemId: 'sys-support',
    result: 'partial',
    executedAt: '2026-10-07T09:40',
    receiptRef: 'R-SUP-7781',
    message: '附件区历史资料尚未清理，需要继续追踪。',
  },
  {
    requestCode: 'DSR-2026-004',
    systemId: 'sys-marketing',
    result: 'executed',
    executedAt: '2026-10-06T15:00',
    receiptRef: 'R-MKT-3310',
    message: '同意撤回回执再次回传，用于验证不重复入账。',
  },
]

type DiffTarget = { batch: ReceiptBatch; item: ReceiptItem } | null
type ConcurrentTarget = ReceiptBatch | null

export function ReceiptsPage() {
  const { data, isLoading } = useWorkspaceQuery()
  const toast = useToast()
  const importMutation = useImportReceiptsMutation()
  const retryMutation = useRetryReceiptBatchMutation()
  const resolveItemMutation = useResolveReceiptItemMutation()
  const resolveConcurrentMutation = useResolveConcurrentBatchMutation()

  const { isOpen: importOpen, onOpen: openImport, onClose: closeImport } = useDisclosure()
  const [batchCode, setBatchCode] = useState(`RCB-${new Date().toISOString().slice(0, 10)}-01`)
  const [source, setSource] = useState('合作方离线回执加密包')
  const [simulateFailure, setSimulateFailure] = useState(false)
  const [failAtIndex, setFailAtIndex] = useState(2)
  const [rows, setRows] = useState<DraftRow[]>([emptyRow()])

  const [diffTarget, setDiffTarget] = useState<DiffTarget>(null)
  const [concurrentTarget, setConcurrentTarget] = useState<ConcurrentTarget>(null)
  const [resolutionNote, setResolutionNote] = useState('')

  const systems = useMemo(() => data?.systems ?? [], [data])
  const requestCodes = useMemo(() => data?.requests.map((request) => request.code) ?? [], [data])

  if (isLoading || !data) return <Box className="panel">正在加载回执对账工作区...</Box>

  const batches = data.receiptBatches
  const totalItems = batches.reduce((sum, batch) => sum + batch.items.length, 0)
  const failedCount = batches.reduce(
    (sum, batch) => sum + batch.items.filter((item) => item.status === 'failed').length,
    0,
  )
  const conflictCount = batches.reduce(
    (sum, batch) =>
      sum +
      batch.items.filter((item) => item.status === 'conflict').length +
      (batch.concurrent && !batch.resolvedAt && batch.status === 'review-required' ? 1 : 0),
    0,
  )
  const duplicateCount = batches.reduce(
    (sum, batch) => sum + batch.items.filter((item) => item.status === 'duplicate').length,
    0,
  )

  function updateRow(index: number, patch: Partial<DraftRow>) {
    setRows((current) => current.map((row, idx) => (idx === index ? { ...row, ...patch } : row)))
  }

  async function submitImport() {
    const invalid = rows.find(
      (row) => !row.requestCode.trim() || !row.systemId.trim() || !row.receiptRef.trim(),
    )
    if (invalid) {
      toast({ title: '每行都需要请求编号、系统和回执编号', status: 'warning' })
      return
    }
    try {
      await importMutation.mutateAsync({
        batchCode: batchCode.trim(),
        source: source.trim(),
        operator: '客服专员',
        failAt: simulateFailure ? failAtIndex : -1,
        items: rows.map((row) => ({
          requestCode: row.requestCode.trim(),
          systemId: row.systemId.trim(),
          result: row.result,
          executedAt: new Date(row.executedAt).toISOString(),
          receiptRef: row.receiptRef.trim(),
          message: row.message.trim(),
        })),
      })
      toast({ title: '回执批次已完成对账', description: '可在下方批次列表查看入账与复核结果。', status: 'success' })
      setRows([emptyRow()])
      closeImport()
    } catch (error) {
      toast({
        title: '批次导入失败',
        description: error instanceof Error ? error.message : '请检查批次内容',
        status: 'error',
      })
    }
  }

  async function retry(batch: ReceiptBatch) {
    try {
      await retryMutation.mutateAsync({ batchId: batch.id, operator: '客服专员' })
      toast({ title: '已从断点重试，完成部分未重复写入', status: 'success' })
    } catch (error) {
      toast({
        title: '重试失败',
        description: error instanceof Error ? error.message : '请稍后再试',
        status: 'error',
      })
    }
  }

  async function resolveItem(resolution: 'keep-existing' | 'accept-incoming') {
    if (!diffTarget) return
    if (resolutionNote.trim().length < 2) {
      toast({ title: '请填写人工选择依据', status: 'warning' })
      return
    }
    try {
      await resolveItemMutation.mutateAsync({
        batchId: diffTarget.batch.id,
        itemId: diffTarget.item.id,
        resolution,
        note: resolutionNote.trim(),
        operator: '隐私负责人',
      })
      toast({ title: '差异处理已记录', status: 'success' })
      setDiffTarget(null)
      setResolutionNote('')
    } catch (error) {
      toast({
        title: '选择未提交',
        description: error instanceof Error ? error.message : '请检查后重试',
        status: 'error',
      })
    }
  }

  async function resolveConcurrent(resolution: 'keep-first' | 'adopt') {
    if (!concurrentTarget) return
    if (resolutionNote.trim().length < 2) {
      toast({ title: '请填写人工选择依据', status: 'warning' })
      return
    }
    try {
      await resolveConcurrentMutation.mutateAsync({
        batchId: concurrentTarget.id,
        resolution,
        note: resolutionNote.trim(),
        operator: '隐私负责人',
      })
      toast({ title: '并发批次已按人工结论处理', status: 'success' })
      setConcurrentTarget(null)
      setResolutionNote('')
    } catch (error) {
      toast({
        title: '复核未提交',
        description: error instanceof Error ? error.message : '请检查后重试',
        status: 'error',
      })
    }
  }

  return (
    <Box>
      <PageHeader
        title="回执批次对账"
        description="按系统任务匹配隐私请求；同一回执沿用原结果，不重复生成证据、审计或延期；差异与并发提交转人工选择。"
        actions={
          <Button colorScheme="brand" leftIcon={<Inbox size={16} />} onClick={openImport}>
            导入离线回执批次
          </Button>
        }
      />

      <Alert status="info" mb="4" borderRadius="5px">
        先到窗口写入结果；同批次再次导入：内容一致则整批沿用原结果，内容不同则整批进入复核。写入中断只保留完成部分，重试从断点恢复，已入账条目不会重复生成证据和审计。
      </Alert>

      <div className="metric-grid">
        <Box className="metric info">
          <Text color="gray.600" fontSize="sm">回执批次</Text>
          <Heading mt="2" mb="1" size="lg">{batches.length}</Heading>
          <Text color="gray.500" fontSize="xs">累计 {totalItems} 条回执</Text>
        </Box>
        <Box className="metric">
          <Text color="gray.600" fontSize="sm">待人工选择</Text>
          <Heading mt="2" mb="1" size="lg">{conflictCount}</Heading>
          <Text color="gray.500" fontSize="xs">结果差异 / 并发提交</Text>
        </Box>
        <Box className="metric warning">
          <Text color="gray.600" fontSize="sm">断点待重试</Text>
          <Heading mt="2" mb="1" size="lg">{failedCount}</Heading>
          <Text color="gray.500" fontSize="xs">完成部分已保留</Text>
        </Box>
        <Box className="metric">
          <Text color="gray.600" fontSize="sm">重复回执沿用</Text>
          <Heading mt="2" mb="1" size="lg">{duplicateCount}</Heading>
          <Text color="gray.500" fontSize="xs">未重复生成证据或审计</Text>
        </Box>
      </div>

      {!batches.length ? (
        <Box className="panel">
          <VStack spacing="2" py="6">
            <FileClock size={34} color="#7a8ea0" />
            <Text fontWeight="600">还没有导入过回执批次</Text>
            <Text color="gray.500" fontSize="sm">
              点击右上角“导入离线回执批次”，可用“填充演示内容”快速体验正常入账、断点重试、重复沿用与差异复核。
            </Text>
          </VStack>
        </Box>
      ) : null}

      {batches.map((batch) => {
        const firstBatch = batch.concurrentOf
          ? batches.find((item) => item.id === batch.concurrentOf)
          : undefined
        const pendingConcurrent = batch.concurrent && !batch.resolvedAt
        return (
          <Box key={batch.id} className="panel">
            <Flex className="panel-title" align="flex-start">
              <Box>
                <HStack mb="1">
                  <Heading size="sm">{batch.batchCode}</Heading>
                  <ReceiptBatchStatusBadge status={batch.status} />
                  {batch.concurrent ? <Badge colorScheme="purple">后到窗口提交</Badge> : null}
                </HStack>
                <Text color="gray.500" fontSize="xs">
                  来源 {batch.source} · 导入人 {batch.importedBy} ·{' '}
                  {new Date(batch.importedAt).toLocaleString('zh-CN')} · 尝试 {batch.attempts} 次 ·{' '}
                  <span className="mono">{batch.digest}</span>
                </Text>
                {firstBatch ? (
                  <Text mt="1" color="purple.700" fontSize="sm">
                    先到批次 {firstBatch.batchCode}（{new Date(firstBatch.importedAt).toLocaleString('zh-CN')}）已写入，本提交不得覆盖。
                  </Text>
                ) : null}
                {batch.resolutionNote ? (
                  <Text mt="1" color="gray.600" fontSize="sm">
                    复核结论：{batch.resolutionNote}（{batch.resolvedBy} · {batch.resolvedAt ? new Date(batch.resolvedAt).toLocaleString('zh-CN') : ''}）
                  </Text>
                ) : null}
              </Box>
              <HStack>
                {batch.items.some((item) => item.status === 'failed') ? (
                  <Button
                    size="sm"
                    colorScheme="orange"
                    leftIcon={<RefreshCw size={14} />}
                    isLoading={retryMutation.isPending}
                    onClick={() => void retry(batch)}
                  >
                    断点重试
                  </Button>
                ) : null}
                {pendingConcurrent ? (
                  <Button
                    size="sm"
                    colorScheme="purple"
                    leftIcon={<Scale size={14} />}
                    onClick={() => {
                      setConcurrentTarget(batch)
                      setResolutionNote('')
                    }}
                  >
                    并发复核
                  </Button>
                ) : null}
              </HStack>
            </Flex>

            <TableContainer>
              <Table size="sm">
                <Thead>
                  <Tr>
                    <Th>请求</Th>
                    <Th>系统任务</Th>
                    <Th>回执编号</Th>
                    <Th>回执结果</Th>
                    <Th>执行时间</Th>
                    <Th w="210px">对账结论</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {batch.items.map((item) => {
                    const system = systems.find((entry) => entry.id === item.systemId)
                    const requestId = item.matchedRequestId
                    return (
                      <Tr key={item.id}>
                        <Td>
                          {requestId ? (
                            <NextLink href={`/requests/${requestId}`}>
                              <Text color="brand.600" fontWeight="600">{item.requestCode}</Text>
                            </NextLink>
                          ) : (
                            <Text fontWeight="600">{item.requestCode}</Text>
                          )}
                        </Td>
                        <Td>{system?.name ?? item.systemId}</Td>
                        <Td className="mono">{item.receiptRef}</Td>
                        <Td><ReceiptResultBadge result={item.result} /></Td>
                        <Td whiteSpace="nowrap">{new Date(item.executedAt).toLocaleString('zh-CN')}</Td>
                        <Td>
                          <VStack align="stretch" spacing="1">
                            <HStack>
                              <ReceiptItemStatusBadge status={item.status} />
                              {item.status === 'conflict' ? (
                                <Button
                                  size="xs"
                                  variant="link"
                                  colorScheme="red"
                                  onClick={() => {
                                    setDiffTarget({ batch, item })
                                    setResolutionNote('')
                                  }}
                                >
                                  查看两边差异并选择
                                </Button>
                              ) : null}
                            </HStack>
                            {item.errorReason ? (
                              <Text color="orange.700" fontSize="xs">{item.errorReason}</Text>
                            ) : null}
                            {item.resolutionNote ? (
                              <Text color="gray.500" fontSize="xs">{item.resolutionNote}</Text>
                            ) : null}
                          </VStack>
                        </Td>
                      </Tr>
                    )
                  })}
                </Tbody>
              </Table>
            </TableContainer>
          </Box>
        )
      })}

      {/* 导入弹窗 */}
      <Modal isOpen={importOpen} onClose={closeImport} size="5xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>导入合作方离线回执批次</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Alert status="warning" mb="4" borderRadius="5px">
              相同批次编号再次提交时不会覆盖首批：内容一致直接沿用原结果，内容不同整批复核。每行按“请求编号 + 系统执行任务”匹配。
            </Alert>
            <HStack align="flex-end" mb="4">
              <FormControl>
                <FormLabel>批次编号</FormLabel>
                <Input value={batchCode} onChange={(event) => setBatchCode(event.target.value)} />
              </FormControl>
              <FormControl>
                <FormLabel>回执来源</FormLabel>
                <Input value={source} onChange={(event) => setSource(event.target.value)} />
              </FormControl>
            </HStack>

            <HStack mb="3">
              <Button
                size="xs"
                variant="outline"
                onClick={() => setRows((current) => [...current, emptyRow()])}
              >
                新增一行
              </Button>
              <Button size="xs" variant="outline" onClick={() => setRows(demoRows)}>
                填充演示内容
              </Button>
              <Select
                size="xs"
                width="230px"
                value={simulateFailure ? String(failAtIndex) : 'off'}
                onChange={(event) => {
                  if (event.target.value === 'off') {
                    setSimulateFailure(false)
                  } else {
                    setSimulateFailure(true)
                    setFailAtIndex(Number(event.target.value))
                  }
                }}
              >
                <option value="off">不模拟写入中断</option>
                <option value="1">模拟在第 2 条后中断（断点保留）</option>
                <option value="2">模拟在第 3 条后中断（断点保留）</option>
              </Select>
              <Box className="grow" />
              <Text color="gray.500" fontSize="xs">{rows.length} 条回执</Text>
            </HStack>

            <TableContainer maxH="340px" overflowY="auto" border="1px solid #e0e7ec" borderRadius="5px">
              <Table size="xs">
                <Thead position="sticky" top="0" bg="white">
                  <Tr>
                    <Th>请求编号</Th>
                    <Th>系统</Th>
                    <Th>结果</Th>
                    <Th>执行时间</Th>
                    <Th>回执编号</Th>
                    <Th>说明</Th>
                    <Th />
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((row, index) => (
                    <Tr key={index}>
                      <Td>
                        <Input
                          size="xs"
                          list="receipt-request-codes"
                          value={row.requestCode}
                          onChange={(event) => updateRow(index, { requestCode: event.target.value })}
                        />
                      </Td>
                      <Td>
                        <Select
                          size="xs"
                          value={row.systemId}
                          onChange={(event) => updateRow(index, { systemId: event.target.value })}
                        >
                          {systems.map((system) => (
                            <option key={system.id} value={system.id}>{system.name}</option>
                          ))}
                        </Select>
                      </Td>
                      <Td>
                        <Select
                          size="xs"
                          value={row.result}
                          onChange={(event) =>
                            updateRow(index, { result: event.target.value as ReceiptResult })
                          }
                        >
                          {Object.entries(receiptResultLabels).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </Select>
                      </Td>
                      <Td>
                        <Input
                          size="xs"
                          type="datetime-local"
                          value={row.executedAt}
                          onChange={(event) => updateRow(index, { executedAt: event.target.value })}
                        />
                      </Td>
                      <Td>
                        <Input
                          size="xs"
                          className="mono"
                          placeholder="R-XXX-0000"
                          value={row.receiptRef}
                          onChange={(event) => updateRow(index, { receiptRef: event.target.value })}
                        />
                      </Td>
                      <Td>
                        <Input
                          size="xs"
                          value={row.message}
                          onChange={(event) => updateRow(index, { message: event.target.value })}
                        />
                      </Td>
                      <Td>
                        <Button
                          size="xs"
                          variant="ghost"
                          colorScheme="red"
                          isDisabled={rows.length === 1}
                          onClick={() => setRows((current) => current.filter((_, idx) => idx !== index))}
                        >
                          删除
                        </Button>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </TableContainer>
            <datalist id="receipt-request-codes">
              {requestCodes.map((code) => (
                <option key={code} value={code} />
              ))}
            </datalist>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr="3" onClick={closeImport}>取消</Button>
            <Button colorScheme="brand" isLoading={importMutation.isPending} onClick={submitImport}>
              开始对账
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 差异选择弹窗 */}
      <Modal
        isOpen={Boolean(diffTarget)}
        onClose={() => setDiffTarget(null)}
        size="2xl"
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            回执差异人工选择 · {diffTarget?.item.receiptRef}
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {diffTarget ? (
              <VStack align="stretch" spacing="4">
                <Alert status="error" borderRadius="5px">
                  新回执与 {diffTarget.item.requestCode} 的已有执行结果或任务对象不一致，系统不会用新回执覆盖旧记录，请逐项选择保留哪一边。
                </Alert>
                <Table size="sm" variant="simple">
                  <Thead>
                    <Tr>
                      <Th>差异项</Th>
                      <Th color="teal.700">原记录（保留）</Th>
                      <Th color="blue.700">新回执（待选）</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {diffTarget.item.diffs.map((diff) => (
                      <Tr key={diff.field}>
                        <Td fontWeight="600">{diff.label}</Td>
                        <Td color="teal.800">{diff.existing}</Td>
                        <Td color="blue.800">{diff.incoming}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
                <FormControl isRequired>
                  <FormLabel>人工选择依据</FormLabel>
                  <Textarea
                    value={resolutionNote}
                    onChange={(event) => setResolutionNote(event.target.value)}
                    placeholder="说明采信哪一边及其依据，将进入请求审计"
                  />
                </FormControl>
              </VStack>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr="3" onClick={() => setDiffTarget(null)}>取消</Button>
            <Button
              colorScheme="teal"
              mr="3"
              isLoading={resolveItemMutation.isPending}
              onClick={() => void resolveItem('keep-existing')}
            >
              保留原记录
            </Button>
            <Button
              colorScheme="blue"
              isLoading={resolveItemMutation.isPending}
              onClick={() => void resolveItem('accept-incoming')}
            >
              采用新回执
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 并发批次复核弹窗 */}
      <Modal
        isOpen={Boolean(concurrentTarget)}
        onClose={() => setConcurrentTarget(null)}
        size="2xl"
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>并发提交批次复核 · {concurrentTarget?.batchCode}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {concurrentTarget ? (
              <VStack align="stretch" spacing="4">
                <Alert status="warning" borderRadius="5px">
                  两个窗口提交了同一批次，先到者已写入。请整体选择沿用首批结果，或逐条采用后到批次（仍会对每条差异再次列差异、不做静默覆盖）。
                </Alert>
                <Table size="sm">
                  <Thead>
                    <Tr>
                      <Th>请求</Th>
                      <Th>系统</Th>
                      <Th>回执编号</Th>
                      <Th>后到结果</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {concurrentTarget.items.map((item) => (
                      <Tr key={item.id}>
                        <Td>{item.requestCode}</Td>
                        <Td>{systems.find((entry) => entry.id === item.systemId)?.name ?? item.systemId}</Td>
                        <Td className="mono">{item.receiptRef}</Td>
                        <Td><ReceiptResultBadge result={item.result} /></Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
                <FormControl isRequired>
                  <FormLabel>人工选择依据</FormLabel>
                  <Textarea
                    value={resolutionNote}
                    onChange={(event) => setResolutionNote(event.target.value)}
                    placeholder="说明采信先到批次还是后到批次及其依据"
                  />
                </FormControl>
              </VStack>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr="3" onClick={() => setConcurrentTarget(null)}>取消</Button>
            <Button
              colorScheme="teal"
              mr="3"
              isLoading={resolveConcurrentMutation.isPending}
              onClick={() => void resolveConcurrent('keep-first')}
            >
              沿用先到批次
            </Button>
            <Button
              colorScheme="blue"
              isLoading={resolveConcurrentMutation.isPending}
              onClick={() => void resolveConcurrent('adopt')}
            >
              采用后到批次
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  )
}
