export async function validateHelperStartup<T extends {destroy():unknown}, R>(
 connect:()=>Promise<T>, validate:(socket:T)=>Promise<R>, cleanup:()=>void|Promise<void>
):Promise<{socket:T;result:R}> {
 let socket:T|undefined
 try {socket=await connect();const result=await validate(socket);return {socket,result}}
 catch(error){socket?.destroy();await cleanup();throw error}
}
