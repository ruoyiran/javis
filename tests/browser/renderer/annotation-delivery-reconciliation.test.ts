import { expect, it } from 'vitest'
import { acknowledgedAnnotationObjects, type AnnotationDelivery } from '../../../src/browser/renderer/annotation-delivery-reconciliation'
import type { BrowserPageAnnotation } from '../../../src/browser/source/shared/browser/element-grab/browser-grab-types'
const original={id:'note-a',browserPageId:'page-a',comment:'Original feedback',intent:'change',priority:'normal',createdAt:'2026-11-19',payload:{url:'https://example.com/'}} as unknown as BrowserPageAnnotation
it('maps an acknowledged serialized snapshot to the unchanged current object after reload',()=>{
 const current=structuredClone(original)
 const rows=[{id:'delivery-a',status:'acknowledged',payload:{context:'context-a',annotations:[structuredClone(original)]}}] as AnnotationDelivery[]
 const matched=acknowledgedAnnotationObjects(rows,{'page-a':[current]})
 expect(matched['page-a'][0]).toBe(current)
})
it('keeps edits made while queued, and never removes merely queued notes',()=>{
 const edited={...original,comment:'Edited feedback'}
 const rows=[{id:'delivery-a',status:'acknowledged',payload:{context:'context-a',annotations:[original]}}] as AnnotationDelivery[]
 expect(acknowledgedAnnotationObjects(rows,{'page-a':[edited]})).toEqual({})
 expect(acknowledgedAnnotationObjects([{...rows[0],status:'queued'}],{'page-a':[original]})).toEqual({})
})
