'use client'

import { useState } from 'react'
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
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
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
  useToast,
} from '@chakra-ui/react'
import { Inbox } from 'lucide-react'
import {
  ReceiptBatchStatusBadge,
  ReceiptItemStatusBadge,
  ReceiptResultBadge,
} from '@/components/ReceiptBadges'
import {
  useResolveReceiptItemMutation,
  useWorkspaceQuery,
} from '@/lib/hooks'
import type { ReceiptBatch, ReceiptItem } from '@/lib/schemas'

export function RequestReceiptPanel({ requestId }: { requestId: string }) {
  const { data } = useWorkspaceQuery()
  const toast = useToast()
  const resolveMutation = useResolveReceiptItemMutation()
  const [target, setTarget] = useState<{ batch: ReceiptBatch; item: ReceiptItem } | null>(null)
  const [note, setNote] = useState('')

  if (!data) return null

  const batches = data.receiptBatches.filter((batch) =>
    batch.items.some((item) => item.matchedRequestId === requestId),
  )

  const entries = batches.flatMap((batch) =>
    batch.items
      .filter((item) => item.matchedRequestId === requestId)
      .map((item) => ({ batch, item })),
  )

  if (!entries.length) {
    return (
      <Box className="panel">
        <Flex className="panel-title">
          <Heading size="sm">回执批次对账</Heading>
          <Badge colorScheme="gray">暂无离线回执</Badge>
        </Flex>
        <Text color="gray.500" fontSize="sm">
          合作方离线带回的系统回执在“回执批次对账”页导入后，将按系统任务匹配到本请求；同一回执再次导入沿用原结果，不重复生成证据或延期。
        </Text>
      </Box>
    )
  }

  async function resolve(resolution: 'keep-existing' | 'accept-incoming') {
    if (!target) return
    if (note.trim().length < 2) {
      toast({ title: '请填写人工选择依据', status: 'warning' })
      return
    }
    try {
      await resolveMutation.mutateAsync({
        batchId: target.batch.id,
        itemId: target.item.id,
        resolution,
        note: note.trim(),
        operator: '隐私负责人',
      })
      toast({ title: '差异处理已记录', status: 'success' })
      setTarget(null)
      setNote('')
    } catch (error) {
      toast({
        title: '选择未提交',
        description: error instanceof Error ? error.message : '请检查后重试',
        status: 'error',
      })
    }
  }

  return (
    <Box className="panel">
      <Flex className="panel-title">
        <HStack>
          <Inbox size={17} color="#237b78" />
          <Heading size="sm">回执批次对账（同一批合并结果）</Heading>
        </HStack>
        <Badge colorScheme="blue">{entries.length} 条回执 / {batches.length} 个批次</Badge>
      </Flex>

      {entries.some(({ item }) => item.status === 'conflict') ? (
        <Alert status="error" mb="3" borderRadius="5px">
          存在与已执行结果/任务对象不一致的回执，未用新回执覆盖旧记录，请逐项人工选择。
        </Alert>
      ) : null}

      <TableContainer>
        <Table size="sm">
          <Thead>
            <Tr>
              <Th>批次</Th>
              <Th>系统任务</Th>
              <Th>回执编号</Th>
              <Th>回执结果</Th>
              <Th>执行时间</Th>
              <Th w="230px">合并结论</Th>
            </Tr>
          </Thead>
          <Tbody>
            {entries.map(({ batch, item }) => {
              const system = data.systems.find((entry) => entry.id === item.systemId)
              return (
                <Tr key={item.id}>
                  <Td>
                    <HStack>
                      <Text fontWeight="600">{batch.batchCode}</Text>
                      <ReceiptBatchStatusBadge status={batch.status} />
                      {batch.concurrent ? <Badge colorScheme="purple">后到</Badge> : null}
                    </HStack>
                    <Text color="gray.500" fontSize="xs" className="mono">{batch.digest}</Text>
                  </Td>
                  <Td>{system?.name ?? item.systemId}</Td>
                  <Td className="mono">{item.receiptRef}</Td>
                  <Td><ReceiptResultBadge result={item.result} /></Td>
                  <Td whiteSpace="nowrap">{new Date(item.executedAt).toLocaleString('zh-CN')}</Td>
                  <Td>
                    <VStack align="stretch" spacing="1">
                      <ReceiptItemStatusBadge status={item.status} />
                      {item.message ? <Text color="gray.600" fontSize="xs">{item.message}</Text> : null}
                      {item.resolutionNote ? (
                        <Text color="gray.500" fontSize="xs">人工：{item.resolutionNote}</Text>
                      ) : null}
                      {item.status === 'conflict' ? (
                        <Button
                          size="xs"
                          variant="outline"
                          colorScheme="red"
                          onClick={() => {
                            setTarget({ batch, item })
                            setNote('')
                          }}
                        >
                          查看差异并选择
                        </Button>
                      ) : null}
                    </VStack>
                  </Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>
      </TableContainer>

      <Modal isOpen={Boolean(target)} onClose={() => setTarget(null)} size="2xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>回执差异人工选择 · {target?.item.receiptRef}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {target ? (
              <VStack align="stretch" spacing="4">
                <Table size="sm">
                  <Thead>
                    <Tr>
                      <Th>差异项</Th>
                      <Th color="teal.700">原记录</Th>
                      <Th color="blue.700">新回执</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {target.item.diffs.map((diff) => (
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
                  <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
                </FormControl>
              </VStack>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr="3" onClick={() => setTarget(null)}>取消</Button>
            <Button colorScheme="teal" mr="3" onClick={() => void resolve('keep-existing')}>
              保留原记录
            </Button>
            <Button colorScheme="blue" onClick={() => void resolve('accept-incoming')}>
              采用新回执
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  )
}
