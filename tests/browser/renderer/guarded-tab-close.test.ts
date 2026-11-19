import {expect,it} from 'vitest'
import {closeGuardedTab} from '../../../src/browser/renderer/guarded-tab-close'
import type {Tab} from '../../../src/browser/source/shared/tab-types'
const tab={id:'tab-a'} as Tab
it('bulk close preserves dirty, pinned and annotated tabs',async()=>{
 for(const protection of [{pinned:true,dirty:false,unsentNotes:false},{pinned:false,dirty:true,unsentNotes:false},{pinned:false,dirty:false,unsentNotes:true}]){
   let exists=true
   const result=await closeGuardedTab(tab,protection,true,{confirmPinned:async()=>true,confirmDirty:async()=>true,confirmNotes:async()=>true,retire:()=>{exists=false}})
   expect(result).toBe(false);expect(exists).toBe(true)
 }
})
it('individual pinned dirty source closes only after both decisions authorize it',async()=>{
 let exists=true
 const ports={confirmPinned:async()=>true,confirmDirty:async()=>false,confirmNotes:async()=>true,retire:()=>{exists=false}}
 expect(await closeGuardedTab(tab,{pinned:true,dirty:true,unsentNotes:false},false,ports)).toBe(false)
 expect(exists).toBe(true)
 expect(await closeGuardedTab(tab,{pinned:true,dirty:true,unsentNotes:false},false,{...ports,confirmDirty:async()=>true})).toBe(true)
 expect(exists).toBe(false)
})
