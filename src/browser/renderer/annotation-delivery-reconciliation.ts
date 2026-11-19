import type { BrowserPageAnnotation } from '../source/shared/browser/element-grab/browser-grab-types'
export type AnnotationDelivery = { id: string; status: 'queued' | 'acknowledged'; payload: { context: string; annotations: BrowserPageAnnotation[] } }
export function acknowledgedAnnotationObjects(deliveries: AnnotationDelivery[], notesByPage: Record<string, BrowserPageAnnotation[]>): Record<string, BrowserPageAnnotation[]> {
  const acknowledged = new Map(deliveries.filter((row) => row.status === 'acknowledged').flatMap((row) => row.payload.annotations.map((note) => [note.id, JSON.stringify(note)] as const)))
  return Object.fromEntries(Object.entries(notesByPage).map(([page, notes]) => [page, notes.filter((note) => acknowledged.get(note.id) === JSON.stringify(note))]).filter(([, notes]) => notes.length))
}
