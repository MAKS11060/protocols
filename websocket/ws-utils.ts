import {encodeBase64} from 'jsr:@std/encoding/base64'

export type Frame = {
  fin: boolean
  opcode: OpCode
  length: number
  frameLength: number
  data: Uint8Array
  mask: Uint8Array | null
}

export enum OpCode {
  ContinuationFrame = 0x0,
  Text = 0x1,
  Binary = 0x2,
  Close = 0x8,
  PingFrame = 0x9,
  PongFrame = 0xa,
}

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

// const MAX_MESSAGE_SIZE = 0xffff // u16::MAX
const MAX_MESSAGE_SIZE = 0xffff_ff
// const MAX_MESSAGE_SIZE = 0xffff_ffff // u32::MAX

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const genAcceptKey = async (key: string | null) => {
  return encodeBase64(
    await crypto.subtle.digest('SHA-1', encoder.encode(key + GUID))
  )
}

export const acceptWebSocket = async (conn: Deno.Conn) => {
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

  const acceptKey = await genAcceptKey(key)
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
  }

  const frameLength = payloadOffset + (masked ? 4 : 0) + payloadLength
  const mask = masked ? buf.subarray(payloadOffset, payloadOffset + 4) : null
  const data = buf.subarray(
    payloadOffset + (masked ? 4 : 0),
    payloadOffset + (masked ? 4 : 0) + payloadLength
  )

  return {
    fin,
    opcode,
    length: payloadLength,
    frameLength,
    mask,
    data,
  }
}
