import { expect, it } from 'vitest'
import { annotationDeliveryContexts } from '../../../src/browser/renderer/annotation-delivery-contexts'
import {
  acknowledgedAnnotationObjects,
  type AnnotationDelivery
} from '../../../src/browser/renderer/annotation-delivery-reconciliation'
import type { BrowserPage } from '../../../src/browser/source/shared/browser-workspace-types'
import type { BrowserPageAnnotation } from '../../../src/browser/source/shared/browser/element-grab/browser-grab-types'
it('recovers a floating acknowledgement after reload with main A still selected', async () => {
  const note = {
    id: 'floating-note',
    browserPageId: 'floating-page',
    comment: 'Feedback'
  } as BrowserPageAnnotation
  const pages = {
    floating: [{ id: 'floating-page', worktreeId: 'global-floating-terminal' }] as BrowserPage[]
  }
  const database: Record<string, AnnotationDelivery[]> = {
    ['global-floating-terminal']: [
      {
        id: 'delivery-f',
        status: 'acknowledged',
        payload: { context: 'global-floating-terminal', annotations: [structuredClone(note)] }
      }
    ]
  }
  const contexts = annotationDeliveryContexts(pages, { 'floating-page': [note] }, 'A')
  const rows = (await Promise.all(contexts.map(async (context) => database[context] ?? []))).flat()
  const matched = acknowledgedAnnotationObjects(rows, { 'floating-page': [note] })
  expect(contexts).toEqual(['A', 'global-floating-terminal'])
  expect(matched['floating-page']).toEqual([note])
})
