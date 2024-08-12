#!/usr/bin/env -S deno run -A --unstable-hmr

import {timingSafeEqual} from 'jsr:@std/crypto/timing-safe-equal'

interface NetAddr {
  family: 'IPv4' | 'IPv6'
  hostname: string
  port: number
}

const StunMessageType = {
  // Class + Method
  BindingRequest: 0x00_01,
} as const

/* https://datatracker.ietf.org/doc/html/rfc5389#section-18.2 */
const StunAttributes = {
  MappedAddress: 0x0001,
  Username: 0x0006,
  MessageIntegrity: 0x0008,
  ErrorCode: 0x0009,
  UnknownAttributes: 0x000a,
  Realm: 0x0014,
  Nonce: 0x0015,
  XOR_MappedAddress: 0x0020,

  // Optional
  Software: 0x8022,
  alternateServer: 0x8023,
  Fingerprint: 0x8028,
} as const

const StunMessageTypeMappedAddress = {
  IPv4: 0x01,
  IPv6: 0x02,
} as const

const magic = Uint8Array.from([0x21, 0x12, 0xa4, 0x42])

const xor = (a: Uint8Array, b: Uint8Array) => a.map((v, i) => v ^ b[i])

export class STUN {
  readonly uri: URL
  readonly socket: Deno.DatagramConn

  constructor(uri: string = 'stun.l.google.com:19302', options?: Deno.UdpListenOptions) {
    this.uri = uri.startsWith('stun://') ? new URL(uri) : new URL(`stun://${uri}`)
    this.socket = Deno.listenDatagram({transport: 'udp', hostname: '0.0.0.0', port: 0, ...options})
  }

  #send(message: Uint8Array) {
    return this.socket.send(message, {transport: 'udp', hostname: this.uri.hostname, port: +this.uri.port})
  }

  #createMessage(type: keyof typeof StunMessageType) {
    // const message = new Uint8Array(20 + 12 + 4 + 20)
    const message = new Uint8Array(20 + 12)
    const view = new DataView(message.buffer)
    const transactionId = crypto.getRandomValues(new Uint8Array(12))

    view.setUint16(0, StunMessageType[type])
    view.setUint16(2, 0) // Message Length
    view.setUint32(4, 0x2112a442) // Magic Cookie
    message.set(transactionId, 8)

    view.setUint16(2, message.length - 20)

    return {message, transactionId}
  }

  #parseAttr(data: Uint8Array) {
    let offset = 0
    return {
      *[Symbol.iterator]() {
        while (offset < data.length) {
          const view = new DataView(data.buffer, data.byteOffset + offset)
          const type = view.getUint16(0)
          const length = view.getUint16(2)
          const value = data.subarray(offset + 4, offset + 4 + length)
          yield {type, length, value}
          offset += 4 + length
        }
      },
    }
  }

  close() {
    this.socket.close()
  }

  async getMappedAddress() {
    const {message, transactionId} = this.#createMessage('BindingRequest')
    await this.#send(message)
    const [data] = await this.socket.receive()

    const view = new DataView(data.buffer)
    if (view.getUint16(0) !== 0x0101) {
      throw new Error('Invalid STUN response')
    }
    if (!timingSafeEqual(data.subarray(8, 20), transactionId)) {
      throw new Error('Invalid transaction ID in STUN response')
    }

    for (const attr of this.#parseAttr(data.subarray(20))) {
      if (attr.type === StunAttributes.XOR_MappedAddress) {
        const view = new DataView(attr.value.buffer)
        const family = view.getUint8(1)
        const port = attr.value.subarray(2, 4)
        const ip = attr.value.subarray(4, 8)
        const addr: NetAddr = {
          hostname: xor(ip, magic).join('.'),
          port: new DataView(xor(port, magic).buffer).getUint16(0),
          family: family === StunMessageTypeMappedAddress.IPv4 ? 'IPv4' : 'IPv6',
        }
        return addr
      }
    }
  }
}
