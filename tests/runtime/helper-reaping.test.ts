import { it, expect } from 'vitest'
import { matchingHelperPids } from '../../src/runtime/helper-reaping.js'
it('matches only the owned helper command and current user',()=>{
 const command='/Applications/Javis.app/Contents/MacOS/javis-helper --agent /private/unique/helper.sock --token-file /private/unique/token --controller-pid 1234'
 const processes=`501 200 ${command}\n501 201 ${command.replace('unique','other')}\n502 202 ${command}\n501 203 ${command} --extra\n501 204 /usr/bin/open -W /Applications/Javis.app`
 expect(matchingHelperPids(processes,command,501)).toEqual([200])
})
