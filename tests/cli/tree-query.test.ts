import { expect, it } from 'vitest'
import { queryComputerTreeText } from '../../src/cli/tree-query.js'

it('searches control text without treating an element index as its content', () => {
  const tree = '0 window Test\n\t12 button Save\n\t13 button Version 12'
  const filtered = queryComputerTreeText(tree, { query: '12' })
  expect(filtered).not.toContain('12 button Save')
  expect(filtered).toContain('13 button Version 12')
  expect(filtered).toContain('1 of 3 elements match')
})

it('keeps ancestor context while hiding unrelated controls', () => {
  const tree = [
    'App=com.apple.finder (pid 1)',
    'Window: "Finder".',
    '',
    '0 window Finder',
    '\t1 group Sidebar',
    '\t\t2 button Downloads',
    '\t\t3 button Recents',
    '\t4 group Toolbar'
  ].join('\n')
  const filtered = queryComputerTreeText(tree, { query: 'downloads' })
  expect(filtered).toContain('0 window Finder')
  expect(filtered).toContain('1 group Sidebar')
  expect(filtered).toContain('2 button Downloads')
  expect(filtered).not.toContain('3 button Recents')
  expect(filtered).not.toContain('4 group Toolbar')
})
