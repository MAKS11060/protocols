#!/usr/bin/env -S deno run -A --watch-hmr

Deno.serve({port: 40443}, (req) => {
  if (req.method === 'GET' && req.url === '/') {
    const {response, socket} = Deno.upgradeWebSocket(req)
    handleWs(socket, req)
    return response
  }

  return Response.error()
})

const handleWs = async (socket: WebSocket, req: Request) => {

}
