import { expect, it, afterEach } from 'vitest'
import { hydrateJavisContexts, javisContextHost, javisContextWorkspace } from '../../../src/browser/source/renderer/src/store/workspaces/javis-context-catalog'
afterEach(()=>hydrateJavisContexts([]))
it('keeps same-named local and remote paths bound to their explicit session owners',()=>{
 hydrateJavisContexts([{id:'local-session',root:'/workspace',owner:{kind:'local'}},{id:'remote-session',root:'/workspace',owner:{kind:'runtime',environmentId:'remote-host'}}])
 expect(javisContextHost('local-session')).toBe('local')
 expect(javisContextHost('remote-session')).toBe('runtime:remote-host')
 expect(javisContextWorkspace('remote-session','local')).toBeUndefined()
 expect(javisContextWorkspace('remote-session','runtime:remote-host')?.path).toBe('/workspace')
})
it('never substitutes local ownership after a restored owner disappears',()=>{
 hydrateJavisContexts([{id:'opaque-session',root:'/workspace',owner:{kind:'ssh',connectionId:'remote'}}])
 hydrateJavisContexts([])
 expect(()=>javisContextHost('opaque-session')).toThrow('unavailable')
 expect(javisContextWorkspace('opaque-session')).toBeUndefined()
})
