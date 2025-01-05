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
    } satisfies Deno.NetAddr & {transport: 'tcp'}
  } else if (type === ADDR_TYPE.IPv6) {
    const ipv6Address = Array.from({length: 16}, (_, i) =>
      view
        .getUint8(1 + i)
        .toString(16)
        .padStart(2, '0')
    ).join(':')
    return {
      transport: 'tcp',
      hostname: ipv6Address,
      port: view.getUint16(17),
    } satisfies Deno.NetAddr & {transport: 'tcp'}
  } else if (type === ADDR_TYPE.DomainName) {
    const len = view.getUint8(1)
    return {
      transport: 'tcp',
      hostname: decoder.decode(new Uint8Array(c.buffer, c.byteOffset + offset + 2, len)),
      port: view.getUint16(offset + 2 + len),
    } satisfies Deno.NetAddr & {transport: 'tcp'}
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

export const isLocalAddr = (conn: Deno.TcpConn) => {
  const localAddrs = ['192.168.', '127.0.0.1']
  return localAddrs.some((addr) => conn.remoteAddr.hostname.startsWith(addr))
}
