import { describe, expect, it } from 'vitest'
import { splitBrowserTextInsertionChunks } from '../../../src/browser/source/shared/browser-text-insertion-chunks'

describe('browser text insertion', () => {
  it('keeps a multibyte character intact below the byte cap', () => {
    expect(splitBrowserTextInsertionChunks('😀a', 1)).toEqual(['😀', 'a'])
  })
})
