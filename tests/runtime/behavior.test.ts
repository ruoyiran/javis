import { it, expect } from 'vitest'
import { validateComputerProviderActionParams } from '../../src/runtime/computer-provider-action-validation.js'
import { rejectContradictedComputerAction } from '../../src/runtime/computer-action-verification-normalization.js'
import { diffComputerTreeText } from '../../src/runtime/computer-snapshot-tree-diff.js'
it('rejects ambiguous click targets before delivery',async()=>{
 await expect(validateComputerProviderActionParams('click',{app:'Finder',elementIndex:1,x:0,y:0})).rejects.toMatchObject({code:'invalid_argument'})
})
it('rejects a native read-back that contradicts setValue',()=>{
 expect(()=>rejectContradictedComputerAction({action:{verification:{state:'unverified',reason:'value_mismatch',actualPreview:'old'}}} as any)).toThrow('did not take effect')
})
it('retains full trees when controls move to different parents',()=>{
 expect(diffComputerTreeText('App\n0 Group\n\t1 Button\n2 Group\n','App\n0 Group\n2 Group\n\t1 Button\n')).toBeNull()
})
