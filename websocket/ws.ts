#!/usr/bin/env -S deno run -A --watch

/**
 * Websocket Server
 *
 * https://datatracker.ietf.org/doc/html/rfc6455
 * https://datatracker.ietf.org/doc/html/rfc6455#section-5.2
 *
 * @module
 */

import {
  printBuf,
  setPrintBufConfig,
} from 'https://raw.githubusercontent.com/MAKS11060/deno-libs/main/printBuf.ts'
import {concat} from 'jsr:@std/bytes/concat'
import {encodeBase64} from 'jsr:@std/encoding/base64'

printBuf
setPrintBufConfig({rowLimit: 4})

export type WebSocketData =
  | {type: 'string'; data: string}
  | {type: 'binary'; data: Uint8Array}

export type Frame = {
  fin: boolean
  opcode: OpCode
  length: number
  data: Uint8Array
  mask: Uint8Array | null
}

type HandlerWS = (e: WebSocketData) => void

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

// const MAX_MESSAGE_SIZE = 0xffff // u16::MAX
// const MAX_MESSAGE_SIZE = 0xffff_ff
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

export const unmask = (payload: Uint8Array, mask: Uint8Array): void => {
  for (let i = 0; i < payload.length; i++) {
    payload[i] ^= mask[i & 3]
  }
}

export const readFrame = (buf: Uint8Array): Frame => {
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
      throw new Error(
        `MAX MESSAGE SIZE: current ${len}, expect ${MAX_MESSAGE_SIZE}`
      )
    }

    payloadOffset = 10
    payloadLength = Number(len)
    // payloadLength = view.getUint32(4) | view.getUint32(0)
  }

  const mask = masked ? buf.subarray(payloadOffset, payloadOffset + 4) : null
  const data = buf.subarray(
    payloadOffset + (masked ? 4 : 0),
    payloadOffset + (masked ? 4 : 0) + payloadLength
  )

  const frameLength = payloadOffset + (masked ? 4 : 0) + payloadLength

  return {
    fin,
    opcode,
    length: frameLength, // Общий размер фрейма
    mask,
    data,
  }

  /*  const mask = masked ? buf.subarray(payloadOffset, payloadOffset + 4) : null
  const data = buf.subarray(
    payloadOffset + (masked ? 4 : 0),
    payloadOffset + (masked ? 4 : 0) + payloadLength
  )

  return {
    fin,
    opcode,
    length: payloadLength + (masked ? 4 : 0) + 2, // Общий размер фрейма
    mask,
    data,
  } */

  // return {
  //   fin,
  //   opcode,
  //   length: payloadLength,
  //   mask: masked ? buf.subarray(payloadOffset, payloadOffset + 4) : null,
  //   data: buf.subarray(
  //     payloadOffset + (masked ? 4 : 0),
  //     payloadOffset + (masked ? 4 : 0) + payloadLength
  //   ),
  // }
}

export const readFrameHeader = (buf: Uint8Array): Omit<Frame, 'data'> => {
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
      throw new Error(
        `MAX MESSAGE SIZE: current ${len}, expect ${MAX_MESSAGE_SIZE}`
      )
    }

    payloadOffset = 10
    payloadLength = Number(len)
    // payloadLength = view.getUint32(4) | view.getUint32(0)
  }

  return {
    fin,
    opcode,
    length: payloadLength,
    mask: masked ? buf.subarray(payloadOffset, payloadOffset + 4) : null,
  }
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


export const handleWebSocketStream = async (conn: Deno.Conn) => {
  const sock = await acceptWebSocket(conn)

  {
    let buffer = new Uint8Array(0)

    const toWebSocketFrame = new TransformStream<Uint8Array, Frame>({
      transform(chunk, controller) {
        buffer = new Uint8Array([...buffer, ...chunk])
        // printBuf(buffer)

        while (buffer.length > 0) {
          try {
            const frame = readFrame(buffer)
            if (buffer.length >= frame.length) {
              unmask(frame.data, frame.mask!)
              controller.enqueue(frame)
              buffer = buffer.subarray(frame.length)
            } else {
              break // Недостаточно данных для полного фрейма
            }
          } catch (error) {
            controller.error(error)
            break
          }
        }

        // // Если у нас есть ожидаемый размер фрейма, добавляем данные в буфер
        // if (expectedFrameLength > 0) {
        //   buffer = new Uint8Array([...buffer, ...chunk])
        //   if (buffer.length >= expectedFrameLength) {
        //     const frame = readFrame(buffer)
        //     controller.enqueue(frame)
        //     buffer = buffer.subarray(expectedFrameLength)
        //     expectedFrameLength = 0 // Сбрасываем ожидаемый размер фрейма
        //   }
        // } else {
        //   // Если у нас нет ожидаемого размера фрейма, пытаемся прочитать первый фрейм
        //   try {
        //     const frame = readFrame(chunk)
        //     expectedFrameLength = frame.length
        //     buffer = new Uint8Array(expectedFrameLength)
        //     buffer.set(chunk.subarray(0, chunk.length))
        //   } catch (error) {
        //     // Если произошла ошибка, возможно, данных недостаточно для полного фрейма
        //     buffer = new Uint8Array([...buffer, ...chunk])
        //   }
        // }
      },
    })

    const readable = sock.readable.pipeThrough(toWebSocketFrame)
    return {readable}
  }

  {
    const b = new Uint8Array(32)
    const buf = new Buffer(b)

    await buf.readFrom(sock)

    printBuf(buf.bytes())

    // const buf = new Uint8Array(32)
    // let n = await sock.read(buf)

    // const frame = readFrameHeader(buf)
    // let headerEnd = frame.mask?.byteOffset! + 4

    // const payload = new Uint8Array(frame.length) // alloc payload
    // payload.set(buf.subarray(headerEnd, headerEnd + frame.length))
    // unmask(payload, frame.mask!)
    // printBuf(buf)

    // const reader = sock.readable.getReader()
    // const data = await reader.read()

    // const toWebSocketFrame = new TransformStream<Uint8Array, Frame>({
    //   transform(chunk, controller) {
    //     printBuf(chunk)
    //     const frame = readFrameHeader(chunk)
    //     console.log(frame)
    //   },
    // })
    // const readable = sock.readable.pipeThrough(toWebSocketFrame)
    // return {readable}
    return {}
  }

  {
    let currFrame: Frame | null = null
    let payload = new Uint8Array()
    let readBytes = 0

    const toWebSocketFrame = new TransformStream<Uint8Array, Frame>({
      transform(chunk, controller) {
        // printBuf(chunk)

        let offset = 0
        while (offset < chunk.byteLength) {
          if (!currFrame) {
            currFrame = readFrame(chunk.subarray(offset))
            payload = new Uint8Array(currFrame.length)
            readBytes = 0
          }

          const remainingBytes = currFrame.length - readBytes
          const bytesToCopy = Math.min(
            remainingBytes,
            chunk.byteLength - offset
          )
          payload.set(
            currFrame.data.subarray(readBytes, readBytes + bytesToCopy),
            readBytes
          )
          readBytes += bytesToCopy
          // offset = currFrame.data.byteOffset + currFrame.data.byteLength
          if (readBytes === currFrame.length) {
            if (currFrame.mask) unmask(payload, currFrame.mask)
            offset = currFrame.data.byteOffset + currFrame.data.byteLength
            // offset = chunk.byteLength

            controller.enqueue({...currFrame, data: payload})
            currFrame = null
            payload = new Uint8Array()
            readBytes = 0
          } else {
            offset += bytesToCopy
          }
          // console.log({offset, bytesToCopy})
        }
      },
    })

    const readable = sock.readable.pipeThrough(toWebSocketFrame)
    return {readable}
  }

  {
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
}

if (import.meta.main) {
  serve(async (conn: Deno.Conn) => {
    const {readable} = await handleWebSocketStream(conn)
    for await (const frame of readable!) {
      console.log(
        [
          `FIN: ${Number(frame.fin)} OpCode: ${OpCode[frame.opcode]}`,
          `bytes: ${frame.length} (${frame.length.toString(16)})  payload: ${
            frame.data.byteLength
          }(${frame.data.byteLength.toString(16)})`,
        ].join('    ')
      )
      printBuf(frame.data, {rowLimit: 2})
    }
  })

  const client = new WebSocketStream('ws://localhost:8000')
  const {writable, readable} = await client.opened
  const writer = writable.getWriter()
  await writer.write(new Uint8Array([1, 2]))
  await writer.write(new Uint8Array([3, 4]))
  await writer.write(new Uint8Array(1))
  await writer.write(new Uint8Array(10))
  await writer.write(new Uint8Array(10))
  await writer.write(new Uint8Array(0xff))
  await writer.write(new Uint8Array(0xffff))
  await writer.write(new Uint8Array(0xfffff))
  await writer.write(new Uint8Array(0xffff + 32))
  await writer.write(new Uint8Array(0x8).map((v) => 0xff))
  await writer.write(new Uint8Array(0xffff).map((v) => 0xff))
  await writer.write('text frame')

  // readable.pipeTo(
  //   new WritableStream({
  //     write(data) {
  //       console.log({data})
  //     },
  //   })
  // )

  // client.close()
  // setTimeout(() => client.close(), 0)
}

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
