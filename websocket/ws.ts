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
import {Buffer} from 'jsr:@std/io/buffer'

printBuf
Buffer

export type WebSocketData =
  | {type: 'string'; data: string}
  | {type: 'binary'; data: Uint8Array}

type Frame = {
  fin: boolean
  opcode: OpCode
  length: number
  data: Uint8Array

  mask: Uint8Array | null
}

type HandlerWS = (e: WebSocketData) => void

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

// const MAX_MESSAGE_SIZE = 0xffff // u16::MAX
const MAX_MESSAGE_SIZE = 0xffff_ffff // u32::MAX

enum OpCode {
  ContinuationFrame = 0x0,
  TextFrame = 0x1,
  BinaryFrame = 0x2,
  Close = 0x8,
  PingFrame = 0x9,
  PongFrame = 0xa,
}

enum ReadyState {
  CONNECTION = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}
const encoder = new TextEncoder()
const decoder = new TextDecoder()

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
  if (s.get(conn) !== ReadyState.OPEN) return null

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
      try {
        await conn.write(packet)
      } catch (e) {
        console.log(e)
      }
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

const unmask = (payload: Uint8Array, mask: Uint8Array): void => {
  for (let i = 0; i < payload.length; i++) {
    payload[i] ^= mask[i & 3]
  }
}

const readFrame = (buf: Uint8Array): Frame => {
  // https://datatracker.ietf.org/doc/html/rfc6455#section-5.2
  const fin = (buf[0] & 0b1000_0000) !== 0
  // const rsv1 = (buf[0] & 0b0100_0000) !== 0
  // const rsv2 = (buf[0] & 0b0010_0000) !== 0
  // const rsv3 = (buf[0] & 0b0001_0000) !== 0
  const opcode: OpCode = buf[0] & 0b0000_1111
  const masked = (buf[1] & 0b1000_0000) !== 0
  let payloadLength = buf[1] & 0b0111_1111

  let payloadOffset = 2
  if (payloadLength === 126) {
    const view = new DataView(buf.buffer, buf.byteOffset + 2)
    payloadLength = view.getUint16(0)
    payloadOffset = 4
  } else if (payloadLength === 127) {
    const view = new DataView(buf.buffer, buf.byteOffset + 2)
    const len = view.getBigUint64(0)
    if (len > MAX_MESSAGE_SIZE) {
      throw new Error(`MAX MESSAGE SIZE: ${MAX_MESSAGE_SIZE}`)
    }

    payloadOffset = 10
    payloadLength = Number(len)
    // payloadLength = view.getUint32(4) | view.getUint32(0)
  }

  // if (masked) {
  //   const maskingKey = buf.subarray(payloadOffset, payloadOffset + 4)
  //   payloadOffset += 4

  //   for (let i = payloadOffset; i < payloadOffset + payloadLength; i++) {
  //     buf[i] ^= maskingKey[(i - payloadOffset) % 4]
  //   }
  // }

  // if (masked) payloadOffset += 4

  return {
    fin,
    opcode,
    length: payloadLength,
    // data: buf.subarray(payloadOffset, payloadOffset + payloadLength),
    mask: masked ? buf.subarray(payloadOffset, payloadOffset + 4) : null,
    data: buf.subarray(
      payloadOffset + (masked ? 4 : 0),
      payloadOffset + (masked ? 4 : 0) + payloadLength
    ),
  }
}

const sendClose = async (conn: Deno.Conn, code = 1000, reason?: string) => {
  new DataView(new Uint8Array(2).buffer).setUint8(0, OpCode.Close)

  const header = [code >>> 8, code & 0x00ff]
  let payload: Uint8Array
  if (reason) {
    const reasonBytes = encoder.encode(reason)
    payload = new Uint8Array(2 + reasonBytes.byteLength)
    payload.set(header)
    payload.set(reasonBytes, 2)
  } else {
    payload = new Uint8Array(header)
  }

  await conn.write(header)
}

const s = new WeakMap<Deno.Conn, ReadyState>()

export const handleWebSocket = async (conn: Deno.Conn, handler: HandlerWS) => {
  let currentMessage = new Uint8Array()
  let nextFrame = new Uint8Array()
  s.set(conn, ReadyState.OPEN)

  for await (const c of conn.readable) {
    while (true) {
      // const {fin, opcode, data} = readFrame(c)
      const {fin, opcode, data} = readFrame(
        nextFrame.byteLength ? nextFrame : c
      )
      nextFrame = new Uint8Array()

      // console.log('c')
      // printBuf(c)
      console.log(`FIN: ${Number(fin)} OpCode: ${OpCode[opcode]}`)
      // printBuf(data)
      // console.log('next frame')
      // printBuf(c.subarray(data.byteOffset + data.byteLength))

      if (opcode === OpCode.ContinuationFrame) {
        if (fin) currentMessage = new Uint8Array()
        else currentMessage = concat([currentMessage, data])
      } else if (opcode === OpCode.TextFrame) {
        if (fin) {
          handler({type: 'string', data: decoder.decode(data)})
          currentMessage = new Uint8Array()
        } else currentMessage = data
      } else if (opcode === OpCode.BinaryFrame) {
        if (fin) {
          handler({type: 'binary', data})
          currentMessage = new Uint8Array()
        } else currentMessage = data
      } else if (opcode === OpCode.PingFrame) {
        await conn.write(new Uint8Array([0x8a, data.length, ...data]))
      } else if (opcode === OpCode.PongFrame) {
        //
      } else if (opcode === OpCode.Close) {
        s.set(conn, ReadyState.CLOSING)

        break
      }

      nextFrame = c.subarray(data.byteOffset + data.byteLength)
    }
  }

  // if (s.get(conn) === ReadyState.CLOSING) {
  // conn.close()
  // s.set(conn, ReadyState.CLOSED)
  // }
}

export const handleWebSocketStream_ = async (conn: Deno.Conn) => {
  const sock = await acceptWebSocket(conn)

  let prevFrame: Frame | null = null
  let payload = new Uint8Array()
  let bytesRead = 0

  const toWebSocket = new TransformStream<Uint8Array, WebSocketData>({
    transform(chunk, controller) {
      if (!prevFrame) {
        const frame = readFrame(chunk)
        console.log(`FIN: ${Number(frame.fin)} OpCode: ${OpCode[frame.opcode]}`)

        // const frameEnd = frame.data.byteOffset + frame.data.byteLength
        // const isEnd = frameEnd === chunk.byteLength

        const isEnd = frame.length === frame.data.byteLength
        // console.log({isEnd}, frame.length, frame.data.byteLength)

        if (!isEnd) {
          prevFrame = frame // save frame
          bytesRead += frame.data.byteLength
        } else {
          // controller.enqueue({type: 'binary', data: frame.data})
        }
      } else {
        // let n = chunk.byteLength >

        prevFrame.data = concat([prevFrame.data, chunk])

        const isEnd = prevFrame.length === prevFrame.data.byteLength
        if (isEnd) {
          if (prevFrame.mask) {
            unmask(prevFrame.data.subarray(0, prevFrame.length), prevFrame.mask)
          }

          const endFrame = prevFrame.data.byteOffset
          console.log(endFrame)
        } else {
        }

        console.log(prevFrame)
      }

      // printBuf(chunk.subarray(0, 64))
      // console.log('c:', chunk.byteLength)
      // console.log(`FIN: ${Number(frame.fin)} OpCode: ${OpCode[frame.opcode]}`)
      // console.log(`payload: ${frame.length}`)
    },
  })

  // let currentOpcode: OpCode | null = null
  // let buf = new Uint8Array()
  // let n = 0

  // const toWebSocket = new TransformStream<Uint8Array, WebSocketData>({
  //   /* transform(chunk, controller) {
  //     // printBuf(chunk)
  //     console.log('write')

  //     // const frame = readFrame(chunk)
  //     // let frameEnd = frame.data.byteOffset + frame.data.byteLength
  //     // let isEnd = frameEnd === chunk.byteLength

  //     // controller.enqueue(frame) // write first frame
  //     let isEnd = false
  //     let frameEnd = 0
  //     while (!isEnd) {
  //       const frame = readFrame(chunk.subarray(frameEnd))
  //       frameEnd = frame.data.byteOffset + frame.data.byteLength
  //       isEnd = frameEnd === chunk.byteLength

  //       // console.log(`FIN: ${Number(frame.fin)} OpCode: ${OpCode[frame.opcode]}`)
  //       // controller.enqueue(frame)
  //     }
  //   }, */
  //   transform(chunk, controller) {
  //     const frame = readFrame(chunk)
  //     console.log(
  //       `FIN: ${Number(frame.fin)} OpCode: ${OpCode[frame.opcode]} `,
  //       `size: ${frame.length} byte: ${frame.data.byteLength}`
  //     )

  //     // while (true) {
  //     //   if (!currentOpcode) {
  //     //     const frame = readFrame(chunk)
  //     //     const frameEnd = frame.data.byteOffset + frame.data.byteLength
  //     //     const isEnd = frameEnd === chunk.byteLength

  //     //     if (isEnd) {
  //     //       controller.enqueue({type: 'binary', data: frame.data})
  //     //     } else {
  //     //       currentOpcode = frame.opcode

  //     //       // controller.enqueue({type: 'binary', data: frame.data})
  //     //     }
  //     //   }

  //     //   if (currentOpcode === OpCode.ContinuationFrame) {

  //     //   }
  //     // }

  //     // while (!isEnd) {
  //     //   if (!isEnd) {
  //     //     const frame = readFrame(chunk)
  //     //     let frameEnd = frame.data.byteOffset + frame.data.byteLength
  //     //     isEnd = frameEnd === chunk.byteLength

  //     //     if (isEnd) controller.enqueue({type: 'binary', data: frame.data})
  //     //     else {
  //     //       buf = new Uint8Array(frame.length)
  //     //       buf.set(frame.data.subarray(0, frameEnd), 0)
  //     //       console.log('alloc', frame.length)
  //     //       currentOpcode = frame.opcode
  //     //     }
  //     //   } else {
  //     //     console.log(buf.byteLength)
  //     //     break
  //     //   }
  //     // }
  //   },
  // })

  return sock.readable.pipeThrough(toWebSocket)
}

export const handleWebSocketStream = async (conn: Deno.Conn) => {
  const sock = await acceptWebSocket(conn)

  let currFrame: Frame | null = null
  let payload = new Uint8Array()
  let readBytes = 0
  let remainingChunk = new Uint8Array()

  const toWebSocketFrame = new TransformStream<Uint8Array, Frame>({
    transform(chunk, controller) {
      while (true) {
        if (!currFrame) {
          const frame = readFrame(concat([remainingChunk, chunk]))
          if (frame.length > MAX_MESSAGE_SIZE) {
            throw new Error(`MAX MESSAGE SIZE is ${MAX_MESSAGE_SIZE}`)
          }

          // if full payload
          if (frame.data.byteLength === frame.length) {
            if (frame.mask) unmask(frame.data, frame.mask)
            controller.enqueue(frame)
          }

          const frameEnd = frame.data.byteOffset + frame.data.byteLength
          if (chunk.byteLength !== frameEnd) {
            remainingChunk = chunk.subarray(frameEnd) // save next frame
          }

          if (remainingChunk.byteLength > 0) {
            // chunk = remainingChunk
            remainingChunk = new Uint8Array()
            // continue
          }

          if (currFrame === null) {
            payload = new Uint8Array(frame.length) // alloc for payload
            payload.set(frame.data, 0) // set first segment
            readBytes += frame.data.byteLength
            currFrame = frame // save frame
            console.log(payload.byteLength)
            return // next chunk
          }
        } else if (currFrame) {
          const remainingBytes = currFrame.length - readBytes
          const bytesToCopy = Math.min(remainingBytes, chunk.length)
          payload.set(chunk.subarray(0, bytesToCopy), readBytes)
          readBytes += bytesToCopy

          if (readBytes === currFrame.length) {
            console.log('read full')
            if (currFrame.mask) unmask(payload, currFrame.mask)
            // console.log(payload.byteLength)
            controller.enqueue({...currFrame, data: payload})

            // reset
            currFrame = null
            payload = new Uint8Array()
            readBytes = 0
          }

          if (chunk.byteLength > bytesToCopy) {
            remainingChunk = chunk.subarray(bytesToCopy) // save data for next iter
          }

          if (remainingChunk.byteLength > 0) {
            chunk = remainingChunk
            remainingChunk = new Uint8Array()
            continue
          }

          return
        }
      }
    },
  })

  const toWebSocketResult = new TransformStream<Frame, Uint8Array>({
    transform(chunk, controller) {
      const {fin, opcode, data} = chunk

      if (opcode === OpCode.ContinuationFrame) {
        // if (fin) currentMessage = new Uint8Array()
        // else currentMessage = concat([currentMessage, data])
      } else if (opcode === OpCode.TextFrame) {
        // if (fin) {
        // handler({type: 'string', data: decoder.decode(data)})
        // currentMessage = new Uint8Array()
        // } else currentMessage = data
      } else if (opcode === OpCode.BinaryFrame) {
        // if (fin) {
        // handler({type: 'binary', data})
        // currentMessage = new Uint8Array()
        // } else currentMessage = data
      } else if (opcode === OpCode.PingFrame) {
        controller.enqueue(new Uint8Array([0x8a, data.length, ...data]))
      } else if (opcode === OpCode.PongFrame) {
        //
      } else if (opcode === OpCode.Close) {
        controller.terminate()
      }
    },
  })

  const readable = sock.readable.pipeThrough(toWebSocketFrame)

  const writable = new WritableStream<Uint8Array | string>({
    write(chunk, controller) {
      console.log('w', chunk)
    },
  })

  return {readable, writable}
}

serve(async (conn: Deno.Conn) => {
  const {readable} = await handleWebSocketStream(conn)
  for await (const frame of readable) {
    // console.log(frame)
    // printBuf(frame.data.subarray(0, 64))
    console.log(
      [
        `FIN: ${Number(frame.fin)} OpCode: ${OpCode[frame.opcode]}`,
        `bytes: ${frame.length}  payload: ${frame.data.byteLength}`,
      ].join('    ')
    )
  }
})

const client = new WebSocketStream('ws://localhost:8000')
const {writable, readable} = await client.opened
const writer = writable.getWriter()
await writer.write(new Uint8Array(10))
await writer.write(new Uint8Array(0xff))
await writer.write(new Uint8Array(0xffff))
// await writer.write(new Uint8Array(0x8).map((v) => 0xff))
// await writer.write(new Uint8Array(0xffff).map((v) => 0xff))

// readable.pipeTo(
//   new WritableStream({
//     write(data) {
//       console.log({data})
//     },
//   })
// )

client.close()
// setTimeout(() => client.close(), 0)

// const client = new WebSocket('ws://localhost:8000')
// client.onopen = (e) => {
//   // client.send(new Uint8Array(2 ** 2))
//   client.send(new Uint8Array(2 ** 16))
//   // client.send(new Uint8Array(0xffff))
//   // client.send(new Uint8Array(0x432123))
//   // client.close()
// }

// serve(async (conn) => {
//   const sock = await acceptWebSocket(conn)
//   // console.log('WebSocket opened')
//   handleWebSocket(sock, (e) => {
//     if (e.type === 'binary') {
//       // printBuf(e.data)
//       console.log('received binary', e.data.byteLength)
//     } else {
//       console.log('message:', e.data)
//     }

//     sendMessage(conn, 'connect ok')
//     // sendMessage(conn, encoder.encode('test'))
//   })
// })

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

*/
