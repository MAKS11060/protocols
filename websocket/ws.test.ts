#!/usr/bin/env -S deno run -A --watch

import {delay} from 'jsr:@std/async/delay'
import {handleWebSocketStream} from './ws.ts'

const serve = async (handler: (conn: Deno.Conn) => void) => {
  const listener = Deno.listen({port: 8000})
  for await (const conn of listener) {
    try {
      handler(conn)
    } catch (e) {
      console.error(e)
    }
  }
}

serve(async (conn: Deno.Conn) => {
  const {readable, writable} = await handleWebSocketStream(conn)
  const writer = writable.getWriter()

  for await (const data of readable) {
    if (typeof data === 'string') {
      console.log('server:', data)
    } else {
      console.log('server:', data.byteLength)
    }
    writer.write(data)
    await delay(1000)
  }

  writer.releaseLock()
  writable.close()
})

const client = new WebSocketStream('ws://localhost:8000')
client.opened.then(() => console.log('client opened'))
client.closed.then(() => console.log('client closed'))

const {writable, readable} = await client.opened
const writer = writable.getWriter()
// write
await writer.write('text frame')
await writer.write(new Uint8Array(8))
// await writer.write(new Uint8Array(0xff))
// await writer.write(new Uint8Array(0xffff))
writer.releaseLock()
{
  let counter = 0
  new ReadableStream(
    {
      async pull(controller) {
        controller.enqueue(new Uint8Array(0xfffff))
        // await delay(1000)
        console.log(
          performance.now().toFixed(2),
          `enqueue ${counter++}`,
          controller.desiredSize
        )
        controller.close()
      },
    },
  ).pipeTo(writable)
}

readable.pipeTo(
  new WritableStream({
    write(data) {
      if (typeof data === 'string') {
        console.log('client:', data)
      } else {
        console.log('client:', data.byteLength)
      }
    },
    close() {
      console.log('readable end')
    },
  })
)

// client.close()
