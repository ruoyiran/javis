import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export function toMcpResult(value: unknown): CallToolResult {
  const object = value && typeof value === 'object' ? value as Record<string, unknown> : null
  const screenshot = object?.screenshot && typeof object.screenshot === 'object'
    ? object.screenshot as Record<string, unknown> : null
  const data = screenshot?.data
  const textValue = screenshot ? { ...object, screenshot: Object.fromEntries(Object.entries(screenshot).filter(([key]) => key !== 'data')) } : value
  const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(textValue) ?? 'null' }]
  if (typeof data === 'string' && data.length) content.push({ type: 'image', data, mimeType: 'image/png' })
  return { content }
}

export function toMcpError(error: unknown): CallToolResult {
  const details = error as { code?: unknown; message?: unknown } | null
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: typeof details?.code === 'string' ? details.code : 'internal_error', message: typeof details?.message === 'string' ? details.message : String(error) }) }] }
}
