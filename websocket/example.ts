#!/usr/bin/env -S deno run -A --watch

import {serveTcp} from '../utils.ts'
import {upgradeWebSocketStream} from './ws.ts'

serveTcp({port: 8000}, async (conn) => {
  console.log(conn.remoteAddr.hostname)

  const {url, headers, readable, writable} = await upgradeWebSocketStream(conn)
  console.log(url, headers)

  const writer = writable.getWriter()
  for await (const msg of readable.values()) {
    console.log({msg})
    writer.write(msg) // loopback
  }

  console.log('[WebSocketStream] Close')
})
