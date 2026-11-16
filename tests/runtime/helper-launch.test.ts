import { it, expect, vi } from 'vitest'
vi.mock('node:child_process',()=>({spawn:vi.fn(()=>({once:vi.fn(),on:vi.fn()}))}))
import { spawn } from 'node:child_process'
import { launchHelperApp } from '../../src/runtime/helper-launch.js'
it('launches the app through LaunchServices with authenticated daemon ownership',()=>{
 launchHelperApp('/Applications/My Javis.app','/private/state/helper.sock','/private/state/token',1234)
 expect(spawn).toHaveBeenCalledWith('/usr/bin/open',['-g','-n','-W','/Applications/My Javis.app','--args','--agent','/private/state/helper.sock','--token-file','/private/state/token','--controller-pid','1234'],{stdio:'ignore'})
})
