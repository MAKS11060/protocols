#!/usr/bin/env -S deno run -A --watch

/* Flow

  Conn =>
    sock = acceptWebSocket(Conn)
    const {readable, writable} = WebSocketHandler(sock)


  WebSocketHandler =>
    readable.
      pipeThrough(wsToFrame)
      pipeThrough(toMessage)

    writable.
      pipeThrough(fromMessage)
      pipeThrough(toMessage)
*/

import {acceptWebSocket} from './ws-utils.ts'
import {transformMessageToWebsocket, transformWebsocketToFrame} from './ws.ts'

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

const handleWebSocketStream = async (conn: Deno.Conn) => {
  const sock = await acceptWebSocket(conn)

  const toWebSocketFrame = transformWebsocketToFrame()
  const toWSMessage = transformMessageToWebsocket()

  const readable = sock.readable.pipeThrough(toWebSocketFrame)
  // const writable = toWSMessage.writable
  // toWSMessage.readable.pipeTo(sock.writable)
  // const writable = toWSMessage.readable.pipeTo(sock.writable)

  const writable = toWSMessage.writable

  return {readable, writable}
}

serve(async (conn: Deno.Conn) => {
  const {readable, writable} = await handleWebSocketStream(conn)
  for await (const data of readable) {
    console.log(data)
  }
  writable.close()
})

const client = new WebSocketStream('ws://localhost:8000')
client.opened.then(() => console.log('client opened'))
client.closed.then(() => console.log('client closed'))

const {writable, readable} = await client.opened
const writer = writable.getWriter()
// write
await writer.write(new Uint8Array(8))
// await writer.write(new Uint8Array(0xff))
// await writer.write(new Uint8Array(0xffff))
// await writer.write('text frame')

//   readable.pipeTo(
//     new WritableStream({
//       write(data) {
//         console.log({data})
//       },
//     })
//   )

for await (const data of readable) {
  console.log('data', data)
}
console.log('readable end')

// if (import.meta.main) {
//   serve(async (conn: Deno.Conn) => {
//     const {readable} = await handleWebSocketStream(conn)
//     for await (const frame of readable!) {

//       // console.log(
//       //   [
//       //     `FIN: ${Number(frame.fin)} OpCode: ${OpCode[frame.opcode]}`,
//       //     `bytes: ${frame.length} (${frame.length.toString(16)})  payload: ${
//       //       frame.data.byteLength
//       //     }(${frame.data.byteLength.toString(16)})`,
//       //   ].join('    ')
//       // )
//       // printBuf(frame.data, {rowLimit: 2})
//     }
//   })

//   const client = new WebSocketStream('ws://localhost:8000')
//   const {writable, readable} = await client.opened
//   const writer = writable.getWriter()
//   // await writer.write(new Uint8Array([1, 2]))
//   // await writer.write(new Uint8Array([3, 4]))
//   // await writer.write(new Uint8Array(1))
//   // await writer.write(new Uint8Array(10))
//   await writer.write(new Uint8Array(0xff))
//   // await writer.write(new Uint8Array(0xffff))
//   // await writer.write(new Uint8Array(0xfffff))
//   // await writer.write(new Uint8Array(0xffff + 32))
//   // await writer.write(new Uint8Array(0x8).map((v) => 0xff))
//   // await writer.write(new Uint8Array(0xffff).map((v) => 0xff))
//   await writer.write('text frame')

//   readable.pipeTo(
//     new WritableStream({
//       write(data) {
//         console.log({data})
//       },
//     })
//   )

//   // client.close()
//   // setTimeout(() => client.close(), 0)
// }

// const client = new WebSocket('ws://localhost:8000')
// client.onopen = (e) => {
//   // client.send(new Uint8Array(2 ** 2))
//   client.send(new Uint8Array(2 ** 16))
//   // client.send(new Uint8Array(0xffff))
//   // client.send(new Uint8Array(0x432123))
//   // client.close()
// }

// import {assertEquals} from 'jsr:@std/assert'
// import {handleWebSocket, WebSocketData} from './ws.ts'

// // Deno.test('handleWebSocket handles fragmented data', async () => {})

// Deno.test('handleWebSocket handles fragmented data', async () => {
//   // return
//   const server = Deno.listen({port: 8080})
//   const client = await Deno.connect({port: 8080})

//   // const serverPromise = new Promise<void>((resolve) => {
//   //   server.accept().then(async (conn) => {
//   //     const messages: WebSocketData[] = []
//   //     await handleWebSocket(conn, (e) => {
//   //       console.log(e)
//   //       messages.push(e)
//   //     })
//   //     assertEquals(messages.length, 1)
//   //     assertEquals(messages[0].type, 'string')
//   //     assertEquals(messages[0].data, 'Hello, world!')
//   //     resolve()
//   //   })
//   // })

//   // const clientPromise = new Promise<void>((resolve) => {
//   //   const data = new TextEncoder().encode('Hello, world!')
//   //   const header = new Uint8Array([0x81, data.length])
//   //   const packet1 = new Uint8Array([...header, ...data.subarray(0, 5)])
//   //   const packet2 = new Uint8Array([0x00, data.length - 5, ...data.subarray(5)])
//   //   client.write(packet1).then(() => {
//   //     client.write(packet2).then(() => {
//   //       client.close()
//   //       resolve()
//   //     })
//   //   })
//   // })

//   const data = new Uint8Array(10)
//   const serverPromise = new Promise<void>((resolve) => {
//     server.accept().then(async (conn) => {
//       const messages: WebSocketData[] = []
//       await handleWebSocket(conn, (e) => {
//         console.log(e)
//         messages.push(e)
//       })
//       // assertEquals(messages.length, 1)
//       assertEquals(messages[0].type, 'binary')
//       assertEquals(messages[0].data, data)
//       resolve()
//     })
//   })

//   const clientPromise = new Promise<void>((resolve) => {
//     const header = new Uint8Array([0b0000_0010, data.length])
//     const packet1 = new Uint8Array([...header, ...data.subarray(0, 5)])
//     const packet2 = new Uint8Array([0b1000_0010, data.length - 5, ...data.subarray(5)])
//     client.write(packet1).then(() => {
//       // setTimeout(() => {
//         client.write(packet2).then(() => {
//           client.close()
//           resolve()
//         })
//       // }, 1000)
//     })
//   })

//   await Promise.all([serverPromise, clientPromise])
//   server.close()
// })
