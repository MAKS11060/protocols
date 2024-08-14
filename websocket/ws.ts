#!/usr/bin/env -S deno run -A --watch

/**
 * Websocket Server
 *
 * https://datatracker.ietf.org/doc/html/rfc6455
 * https://datatracker.ietf.org/doc/html/rfc6455#section-5.2
 *
 * @module
 */

import {printBuf} from 'https://raw.githubusercontent.com/MAKS11060/deno-libs/main/printBuf.ts'
import {concat} from 'jsr:@std/bytes/concat'
import {encodeBase64} from 'jsr:@std/encoding/base64'
printBuf

export type WebSocketData =
  | {type: 'string'; data: string}
  | {type: 'binary'; data: Uint8Array}

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

const MAX_PAYLOAD = 2 ** 16 - 1

enum OpCode {
  ContinuationFrame = 0x0,
  TextFrame = 0x1,
  BinaryFrame = 0x2,
  ConnectionCloseFrame = 0x8,
  PingFrame = 0x9,
  PongFrame = 0xa,
}

const WS_READY_STATE = {
  CONNECTION: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const generateKey = async (key: string | null) => {
  return encodeBase64(
    await crypto.subtle.digest('SHA-1', encoder.encode(key + GUID))
  )
}

const acceptWebSocket = async (conn: Deno.Conn) => {
  const httpBuf = new Uint8Array(1024)
  let n = await conn.read(httpBuf)
  const headers = new Headers()

  for (const line of new TextDecoder().decode(httpBuf).split('\r\n')) {
    const [key, value] = line.split(': ')
    if (key && value) headers.set(key, value)
  }

  const key = headers.get('sec-websocket-key')
  if (!key) {
    conn.close()
    throw new Error('sec-websocket-key header not found')
  }

  const acceptKey = await generateKey(key)
  const acceptHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    'Sec-WebSocket-Version: 13',
  ]

  await conn.write(encoder.encode(acceptHeaders.concat('\r\n').join('\r\n')))

  return conn
}

const sendMessage = async (conn: Deno.Conn, message: string | ArrayBuffer) => {
  if (message instanceof Uint8Array) {
    const maxPayloadSize = 125
    const numChunks = Math.ceil(message.length / maxPayloadSize)

    for (let i = 0; i < numChunks; i++) {
      const offset = i * maxPayloadSize
      const chunk = message.subarray(offset, offset + maxPayloadSize)
      const fin = i === numChunks - 1 ? 0b1000_0000 : 0
      const opcode = i === 0 ? 0x2 : 0x0
      const header = new Uint8Array([fin | opcode, chunk.length])
      const packet = new Uint8Array([...header, ...chunk])
      await conn.write(packet)
    }
    return
  }

  const data =
    typeof message === 'string'
      ? new TextEncoder().encode(message)
      : new Uint8Array(message)

  const header = new Uint8Array([
    typeof message === 'string' ? 0x81 : 0x82,
    data.length,
  ])
  const packet = new Uint8Array([...header, ...data])
  await conn.write(packet)
}

function handleMessage(
  opcode: number,
  data: Uint8Array,
  handler: (e: WebSocketData) => void
) {
  if (opcode === OpCode.TextFrame) {
    handler({type: 'string', data: new TextDecoder().decode(data)})
  } else if (opcode === OpCode.BinaryFrame) {
    handler({type: 'binary', data})
  }
}

const readFrame = (buf: Uint8Array): Uint8Array => {

}

export const handleWebSocket = async (
  conn: Deno.Conn,
  handler: (e: WebSocketData) => void
) => {
  const frameBuf = new Uint8Array(1024)
  let currentBuf = new Uint8Array(0)
  let currentMessage = new Uint8Array()
  let currentOpcode: number | null = null

  // while (true) {
  // let n = await conn.read(frameBuf)
  // const buf = concat([currentBuf, frameBuf])
  // n = buf.byteLength
  // console.log(n)
  // if (n === 0) break
  for await (const c of conn.readable) {
    while (true) {
      const buf = concat([currentBuf, c]) // prev + new data
      const n = buf.byteLength
      // console.log('buf', buf.byteLength)

      // https://datatracker.ietf.org/doc/html/rfc6455#section-5.2
      const fin = (buf[0] & 0b1000_0000) !== 0
      // const rsv1 = (buf[0] & 0b0100_0000) !== 0
      // const rsv2 = (buf[0] & 0b0010_0000) !== 0
      // const rsv3 = (buf[0] & 0b0001_0000) !== 0
      const opcode: OpCode = buf[0] & 0b0000_1111
      const masked = (buf[1] & 0b1000_0000) !== 0
      const payloadLength = buf[1] & 0b0111_1111
      let payloadOffset = 2

      console.log(
        `fin ${fin}`.padEnd(10, ' ') +
          `opcode: 0b${opcode.toString(2).padStart(8, '0')} ${OpCode[opcode]}`
      )

      if (payloadLength === 126) payloadOffset = 4
      else if (payloadLength === 127) payloadOffset = 10

      if (masked) {
        const maskingKey = buf.subarray(payloadOffset, payloadOffset + 4)
        payloadOffset += 4

        for (let i = payloadOffset; i < n; i++) {
          buf[i] ^= maskingKey[(i - payloadOffset) % 4]
        }
      }

      const data = buf.subarray(payloadOffset, payloadOffset + payloadLength)
      switch (opcode) {
        case OpCode.ContinuationFrame:
          currentMessage = concat([currentMessage, data])
          if (fin) {
            currentMessage = new Uint8Array()
          }
          break
        case OpCode.TextFrame:
          currentMessage = data
          if (fin) {
            handler({type: 'string', data: decoder.decode(data)})
            currentMessage = new Uint8Array()
          }
          break
        case OpCode.BinaryFrame:
          currentMessage = data
          if (fin) {
            handler({type: 'binary', data})
            currentMessage = new Uint8Array()
            currentOpcode = null
          }
          break
        case OpCode.PingFrame:
          await conn.write(new Uint8Array([0x8a, data.length, ...data]))
          break
        case OpCode.PongFrame:
          break
        case OpCode.ConnectionCloseFrame:
          conn.close()
          return
      }

      // save data for next iteration
      currentBuf = buf.subarray(payloadOffset + payloadLength)
      if (!currentBuf.byteLength) {
        currentBuf = new Uint8Array()
        break // next iter
      }
    }
  }

  conn.close()
}

const serve = async () => {
  const listener = Deno.listen({port: 8000})
  for await (const conn of listener) {
    try {
      const sock = await acceptWebSocket(conn)
      console.log('WebSocket opened')
      // handleWebSocket(sock, (e) => {
      handleWebSocket(sock, (e) => {
        if (e.type === 'binary') {
          // printBuf(e.data)
          console.log('received binary', e.data.byteLength)
        } else {
          console.log('message:', e.data)
        }

        sendMessage(conn, 'connect ok')
        // sendMessage(conn, encoder.encode('test'))
      })
    } catch (e) {
      console.error(e)
    }
  }
}

serve()

const client = new WebSocket('ws://localhost:8000')
client.onopen = (e) => {
  console.log('open')
  setTimeout(() => {
    const data = new Uint8Array(2)
    // const data = new Uint8Array(1024 * 2)
    client.send(data)
    client.close()
  }, 500)
}

// new TransformStream<{}, Uint8Array>({
//   transform(chunk, c) {
//     chunk
//   },
//   flush() {},
// })

// const client = new WebSocket('ws://localhost:8000')
// client.onopen = (e) => {
//   console.log('open')
//   // client.close()
//   setTimeout(() => {
//     // client.send(new Uint8Array(100))
//     client.send(new Uint8Array(1000 * 3))
//   }, 300)
// }

// client.onclose = (e) => console.log('close')
// client.onmessage = (e) => console.log('msg', e.data)

// class WS extends EventTarget {
//   onclose(cb: (ev: CloseEvent) => any) {}
//   onerror(cb: (this: WS, ev: Event | ErrorEvent) => any) {}
//   onmessage(cb: (this: WS, ev: MessageEvent) => any) {}
//   onopen(cb: (this: WS, ev: Event) => any) {}
//   close(code?: number, reason?: string): void {}
//   send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {}
// }

/* Deno.serve((req) => {
  const {response, socket} = Deno.upgradeWebSocket(req)
  socket.onmessage = (e) => {
    console.log(new Uint8Array(e.data).byteLength)
  }
  return response
})

const client = new WebSocket('ws://localhost:8000')
client.onopen = (e) => {
  console.log('open')
  setTimeout(() => {
    // client.send(new Uint8Array(100))
    const data = new Uint8Array(1024 * 1024 * 512)
    client.send(data.subarray(0, data.byteLength / 2))
    client.send(data.subarray(data.byteLength / 2))
    // client.close()
  }, 500)
}
client.onerror = (e) => console.error('err',e.error, e.code)
 */
