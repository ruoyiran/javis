import { spawn, type ChildProcess } from 'node:child_process'
export function launchHelperApp(appPath:string, socketPath:string, tokenPath:string, controllerPid:number):ChildProcess {
 return spawn('/usr/bin/open',['-g','-n','-W',appPath,'--args','--agent',socketPath,'--token-file',tokenPath,'--controller-pid',String(controllerPid)],{stdio:'ignore'})
}
