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
import {Frame, OpCode, acceptWebSocket, readFrame, unmask} from './ws-utils.ts'

printBuf
setPrintBufConfig({rowLimit: 4})

export type WebSocketData =
  | {type: 'string'; data: string}
  | {type: 'binary'; data: Uint8Array}

type HandlerWS = (e: WebSocketData) => void

enum ReadyState {
  CONNECTION = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

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

const createWebSocketFrame = (
  data: Uint8Array,
  opcode: OpCode,
  fin: boolean = true,
  mask: Uint8Array | null = null
): Uint8Array => {
  const payloadLength = data.length
  let headerLength = 2

  if (payloadLength >= 126) {
    headerLength += 2
    if (payloadLength >= 65536) {
      headerLength += 6
    }
  }

  const frameLength = headerLength + payloadLength + (mask ? 4 : 0)
  const frame = new Uint8Array(frameLength)

  frame[0] = (fin ? 0b1000_0000 : 0) | opcode
  frame[1] =
    (mask ? 0b1000_0000 : 0) | (payloadLength < 126 ? payloadLength : 126)

  let offset = 2
  if (payloadLength >= 126) {
    if (payloadLength < 65536) {
      new DataView(frame.buffer, frame.byteOffset + offset).setUint16(
        0,
        payloadLength
      )
      offset += 2
    } else {
      new DataView(frame.buffer, frame.byteOffset + offset).setBigUint64(
        0,
        BigInt(payloadLength)
      )
      offset += 8
    }
  }

  if (mask) {
    frame.set(mask, offset)
    offset += 4
  }

  frame.set(data, offset)

  return frame
}

// incoming
export const transformWebsocketToFrame = () => {
  let buffer = new Uint8Array(0)

  return new TransformStream<Uint8Array, Frame>({
    transform(chunk, controller) {
      buffer = new Uint8Array([...buffer, ...chunk])

      while (buffer.length > 0) {
        try {
          const frame = readFrame(buffer)
          if (buffer.length >= frame.length) {
            unmask(frame.data, frame.mask!)
            controller.enqueue(frame)
            buffer = buffer.subarray(frame.frameLength) // next frame
          } else {
            break // Недостаточно данных для полного фрейма
          }
        } catch (error) {
          controller.error(error)
          break
        }
      }
    },
    cancel() {
      console.log('c')
    },
  })
}

// outgoing
export const transformMessageToWebsocket = () => {
  return new TransformStream<Uint8Array | string, Uint8Array>({
    transform(chunk, controller) {
      let data: Uint8Array
      let opcode: OpCode

      if (typeof chunk === 'string') {
        data = encoder.encode(chunk)
        opcode = OpCode.Text
      } else {
        data = chunk
        opcode = OpCode.Binary
      }

      const frame = createWebSocketFrame(data, opcode)
      controller.enqueue(frame)
    },
    cancel() {
      console.log('cancel')
    },
    flush(controller ) {
      console.log('flush')
    },
  })
}

export const handleWebSocketStream = async (conn: Deno.Conn) => {
  const sock = await acceptWebSocket(conn)

  const toWebSocketFrame = transformWebsocketToFrame()
  const toWSMessage = transformMessageToWebsocket()

  const toWebSocketResult = new TransformStream<Frame, Uint8Array>({
    transform(chunk, controller) {
      const {fin, opcode, data} = chunk

      if (opcode === OpCode.ContinuationFrame) {
        // if (fin) currentMessage = new Uint8Array()
        // else currentMessage = concat([currentMessage, data])
      } else if (opcode === OpCode.Text) {
        // if (fin) {
        // handler({type: 'string', data: decoder.decode(data)})
        // currentMessage = new Uint8Array()
        // } else currentMessage = data
      } else if (opcode === OpCode.Binary) {
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
  const writable = toWSMessage.writable
  toWSMessage.readable.pipeTo(sock.writable)

  return {readable, writable}
}
