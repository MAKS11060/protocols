/**
 * WebSocket Stream Server
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
import {
  Frame,
  OpCode,
  acceptWebSocket,
  createWebSocketFrame,
  readFrame,
  unmask,
} from './ws-utils.ts'

setPrintBufConfig({rowLimit: 4})
printBuf

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// socket -> frame
const transformWebsocketToFrame = () => {
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
    flush(controller) {
      console.log('f')
    },
    cancel() {
      console.log('c')
    },
  })
}

// frame -> result
const frameToResult = () => {
  // let data: Uint8Array = new Uint8Array()
  return new TransformStream<Frame, string | Uint8Array>({
    transform(frame, controller) {
      if (frame.opcode === OpCode.ContinuationFrame) {
        // TODO
        return
      }

      if (frame.opcode === OpCode.Text) {
        controller.enqueue(decoder.decode(frame.data))
      } else if (frame.opcode === OpCode.Binary) {
        controller.enqueue(frame.data)
      } else if (frame.opcode === OpCode.Close) {
        controller.terminate()
      }
    },
  })
}

// data -> frame -> socket
const transformDataToWebsocket = () => {
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
    flush(controller) {
      console.log('flush')
    },
    cancel() {
      console.log('cancel')
    },
  })
}

export const handleWebSocketStream = async (conn: Deno.Conn) => {
  const sock = await acceptWebSocket(conn)

  // socket -> frame -> result
  const readable = sock.readable
    .pipeThrough(transformWebsocketToFrame())
    .pipeThrough(frameToResult())

  // writable -> frame -> socket
  const frameWriter = transformDataToWebsocket()
  frameWriter.readable.pipeTo(sock.writable)

  return {readable, writable: frameWriter.writable}
}
