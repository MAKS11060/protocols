import {ADDR_TYPE} from './enum.ts'

const decoder = new TextDecoder()

export const parseAuthPassword = (buf: Uint8Array) => {
  const username = new Uint8Array(buf.buffer, 2 /* VER + IDLEN */, buf.at(1) /* IDLEN */)
  const password = new Uint8Array(
    buf.buffer,
    username.byteLength + 2 /* VER + IDLEN */ + 1 /* PWLEN */,
    buf.at(username.byteLength + 2) /* PWLEN */
  )
  return {
    username: decoder.decode(username),
    password: decoder.decode(password),
  }
}

export const parseSocks5Addr = (c: Uint8Array, offset = 3) => {
  const view = new DataView(c.buffer, offset)
  const type = view.getUint8(0) as ADDR_TYPE

  if (type === ADDR_TYPE.IPv4) {
    return {
      transport: 'tcp',
      hostname: `${view.getUint8(1)}.${view.getUint8(2)}.${view.getUint8(3)}.${view.getUint8(4)}`,
      port: view.getUint16(5),
      type,
    } satisfies Deno.NetAddr & {transport: 'tcp'} & {type: ADDR_TYPE}
  } else if (type === ADDR_TYPE.IPv6) {
    const ipv6Array = new Uint8Array(c.buffer, view.byteOffset + 1, 16)
    return {
      transport: 'tcp',
      hostname: uint8ArrayToIpv6(ipv6Array),
      port: view.getUint16(17),
      type,
    } satisfies Deno.NetAddr & {transport: 'tcp'} & {type: ADDR_TYPE}
  } else if (type === ADDR_TYPE.DomainName) {
    const len = view.getUint8(1)
    return {
      transport: 'tcp',
      hostname: decoder.decode(c.subarray(view.byteOffset + 2, view.byteOffset + 2 + len)),
      port: view.getUint16(2 + len),
      type,
    } satisfies Deno.NetAddr & {transport: 'tcp'} & {type: ADDR_TYPE}
  }

  throw new Error('Invalid ADDR type')
}

export const bndAddr = (addr: string, port: number) => {
  return {
    addr: new Uint8Array(addr.split('.').map((octet) => parseInt(octet))),
    port: new Uint8Array([(port >> 8) & 0xff, port & 0xff]),
  }
}

export const bndAddrFromNetAddr = ({hostname: addr, port}: Deno.NetAddr) => {
  return {
    addr: new Uint8Array(addr.split('.').map((octet) => parseInt(octet))),
    port: new Uint8Array([(port >> 8) & 0xff, port & 0xff]),
  }
}

export const getBndAddr = () => {
  const bndAddr = new Uint8Array(4)
  for (const {address} of Deno.networkInterfaces()) {
    if (address === '127.0.0.1') {
      bndAddr.set(address.split('.').map((octet) => parseInt(octet)))
      break
    }
  }

  return bndAddr
}

export const isLocalAddr = (addr: Deno.NetAddr) => {
  const localAddrs = ['192.168.', '127.0.0.1']
  return localAddrs.some((v) => addr.hostname.startsWith(v))
}

export const ipv6ToUint8Array = (ipv6: string): Uint8Array => {
  const segments = ipv6.split(':')

  if (segments.length !== 8) {
    throw new Error('Invalid IPv6 address')
  }

  const result = new Uint8Array(16)

  for (let i = 0; i < 8; i++) {
    const segment = parseInt(segments[i], 16)
    if (isNaN(segment) || segment < 0 || segment > 0xffff) {
      throw new Error('Invalid IPv6 segment')
    }
    result[2 * i] = (segment >> 8) & 0xff
    result[2 * i + 1] = segment & 0xff
  }

  return result
}

export const uint8ArrayToIpv6 = (uint8Array: Uint8Array, compact: boolean = false): string => {
  if (uint8Array.length !== 16) {
    throw new Error('Invalid Uint8Array length')
  }

  const segments: string[] = []

  for (let i = 0; i < 8; i++) {
    const highByte = uint8Array[2 * i]
    const lowByte = uint8Array[2 * i + 1]
    const segment = (highByte << 8) | lowByte
    segments.push(segment.toString(16).toUpperCase().padStart(4, '0'))
  }

  if (compact) {
    let compressed = false
    for (let i = 0; i < segments.length; i++) {
      if (segments[i] === '0000') {
        if (!compressed) {
          segments[i] = ''
          compressed = true
        } else {
          segments[i] = '0'
        }
      }
    }
  }

  // return segments.join(':').replace(/(^|:)(:|$)/g, '::')
  return segments.join(':').replace(/((^|:)(0(:|$)){2,})/g, '::')
}
