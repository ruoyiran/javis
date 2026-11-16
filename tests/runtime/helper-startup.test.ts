import { it, expect, vi } from 'vitest'
import { validateHelperStartup } from '../../src/runtime/helper-startup.js'
it('destroys the unvalidated connection and cleans the helper on canceled startup',async()=>{
 const socket={destroy:vi.fn()}, cleanup=vi.fn()
 await expect(validateHelperStartup(async()=>socket,async()=>{throw new Error('canceled')},cleanup)).rejects.toThrow('canceled')
 expect(socket.destroy).toHaveBeenCalledOnce()
 expect(cleanup).toHaveBeenCalledOnce()
})
