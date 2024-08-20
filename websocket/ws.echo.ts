#!/usr/bin/env -S deno run -A --unstable-hmr --env

import {handleWebSocketStream} from './ws.ts'

const serve = async (handler: (conn: Deno.Conn) => Promise<void>) => {
  const listener = Deno.listen({port: 8000})
  for await (const conn of listener) {
    try {
      handler(conn).catch((e) => {
        console.error('err', e)
      })
    } catch (e) {
      console.error(e)
    }
  }
}

const serveTls = async (handler: (conn: Deno.TlsConn) => Promise<void>) => {
  const key = Deno.readTextFileSync(Deno.env.get('KEY')!)
  const cert = Deno.readTextFileSync(Deno.env.get('CERT')!)
  const listener = Deno.listenTls({port: 40443, key, cert})
  for await (const conn of listener) {
    try {
      handler(conn).catch((e) => {
        console.error('err', e)
      })
    } catch (e) {
      console.error(e)
    }
  }
}

serveTls(async (conn: Deno.Conn) => {
  const {readable, writable, headers, url} = await handleWebSocketStream(conn)
  const writer = writable.getWriter()
  console.log({headers, url})
  for await (const data of readable) {
    if (typeof data === 'string') {
      console.log('server:', data)
    } else {
      console.log('server:', data.byteLength)
    }
    writer.write(data)

    setTimeout(() => {
      writer.close()
      console.log('writer.close')
    }, 3000)
  }
  console.log('readable closed')

  writer.releaseLock()
  writable.close()
})
