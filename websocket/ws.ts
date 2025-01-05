/**
 * @author MAKS11060
 *
 * Implementation of WebSocketStream server
 * Based on WebStream API
 *
 * https://datatracker.ietf.org/doc/html/rfc6455
 * https://datatracker.ietf.org/doc/html/rfc6455#section-5.2
 *
 */

import {
  Frame,
  OpCode,
  acceptWebSocket,
  createWebSocketFrame,
  readFrame,
  unmask,
} from './ws-utils.ts'

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
            break // collect full frame
          }
        } catch (error) {
          controller.error(error)
          break
        }
      }
    },
    flush(controller) {
      // console.log('f')
    },
    cancel() {
      // console.log('client close conn')
    },
  })
}

// frame -> result
const transformFrameToResult = () => {
  let continuationData = new Uint8Array()
  let continuationOpcode: OpCode | null = null

  return new TransformStream<Frame, string | Uint8Array>({
    transform(frame, controller) {
      if (frame.opcode === OpCode.ContinuationFrame) {
        if (continuationOpcode === null) {
          throw new Error('Received continuation frame without initial frame')
        }
        continuationData = new Uint8Array([...continuationData, ...frame.data])
        if (frame.fin) {
          if (continuationOpcode === OpCode.Text) {
            controller.enqueue(decoder.decode(frame.data))
          } else if (continuationOpcode === OpCode.Binary) {
            controller.enqueue(frame.data)
          }
          continuationData = new Uint8Array()
          continuationOpcode = 0
        }
      } else {
        if (continuationOpcode !== null) {
          throw new Error('Received new frame before finishing continuation frames')
        }

        if (frame.opcode === OpCode.Text || frame.opcode === OpCode.Binary) {
          continuationOpcode = frame.opcode
          continuationData = frame.data
          if (frame.fin) {
            if (frame.opcode === OpCode.Text) {
              controller.enqueue(new TextDecoder().decode(continuationData))
            } else if (frame.opcode === OpCode.Binary) {
              controller.enqueue(continuationData)
            }
            continuationData = new Uint8Array(0)
            continuationOpcode = null
          }
        } else if (frame.opcode === OpCode.Close) {
          controller.terminate()
        }
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
      // console.log('flush')
    },
    cancel() {
      // console.log('cancel')
    },
  })
}

export const upgradeWebSocketStream = async (conn: Deno.Conn, protocol?: string) => {
  const {conn: sock, headers, url} = await acceptWebSocket(conn, protocol)

  // socket -> frame -> result
  const readable = sock.readable
    .pipeThrough(transformWebsocketToFrame())
    .pipeThrough(transformFrameToResult())

  // writable -> frame -> socket
  const frameWriter = transformDataToWebsocket()
  frameWriter.readable.pipeTo(sock.writable)

  return {readable, writable: frameWriter.writable, headers, url}
}
