#!/usr/bin/env -S deno run -A --watch-hmr

import {copy} from 'jsr:@std/io/copy'
import {printBuf} from "../deps.ts"
import {serveTcp} from '../utils.ts'
import {getBndAddr, parseAuthPassword} from './utils.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const VER = 0x05
const RSV = 0x00

enum AUTH {
  NoAuth = 0x00,
  Password = 0x02,
}

enum ADDR_TYPE {
  IPv4 = 0x01,
  IPv6 = 0x04,
  DomainName = 0x03,
}

const CLIENT_CMD = {
  TCP_IP_StreamConnection: 0x01,
  TCP_IP_PortBinding: 0x02,
  UDP_Port: 0x03,
} as const

const CLIENT_ADDR_TYPE = {
  IPv4: 0x01,
  IPv6: 0x04,
  DomainName: 0x03,
} as const

const SERVER_RES = {
  RequestGranted: 0x00,
  GeneralFailure: 0x01,
  ConnectionNotAllowedByRuleset: 0x02,
  NetworkUnreachable: 0x03,
  HostUnreachable: 0x04,
  ConnectionRefusedByDestinationHost: 0x05,
  TTLExpired: 0x06,
  CommandNotSupportedOrProtocolError: 0x07,
  AddressTypeNotSupported: 0x08,
} as const

const acceptAuthMethod = (authType: AUTH | number = 0xff) => new Uint8Array([VER, authType])

const authGranted = (status = true) => new Uint8Array([0x01, status ? 0x00 : 0x01])

const acceptConn = (type: keyof typeof SERVER_RES) => new Uint8Array([VER, SERVER_RES[type]])

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

enum ConnectionState {
  ClientHello,
  ClientAuth,
  ClientRequest,
  Close,
  Open,
}

export const acceptSocks5 = async (
  conn: TransformStream<Uint8Array, Uint8Array>,
  localPort: number,
  options?: {
    noAuth?: boolean
    auth?: {
      password?: (cred: {username: string; password: string}) => Promise<boolean> | boolean
    }
  }
) => {
  options ??= {}

  const writer = conn.writable.getWriter()

  let state: ConnectionState = ConnectionState.ClientHello

  for await (const c of conn.readable.values({preventCancel: true})) {
    if (state === ConnectionState.Close) break
    if (state === ConnectionState.ClientHello) {
      const view = new DataView(c.buffer)
      printBuf(c)

      // VER
      if (view.getUint8(0) !== VER) {
        state = ConnectionState.Close
        await writer.write(acceptConn('GeneralFailure'))
        await writer.close()
        return
      }

      // AuthN // TODO
      /* const authN = view.getUint8(1) // auth method count
      const authMethods: any[] = []
      for (let i = 0; i < authN; i++) {
        authMethods.push
      } */

      if (!options.auth || options.noAuth) {
        await writer.write(acceptAuthMethod(AUTH.NoAuth))
        state = ConnectionState.ClientRequest
      } else if (options.auth.password) {
        await writer.write(acceptAuthMethod(AUTH.Password))
        state = ConnectionState.ClientAuth
      }
    } else if (state === ConnectionState.ClientAuth) {
      const cred = parseAuthPassword(c)

      if (options.auth?.password) {
        const granted =
          options.auth.password.constructor.name === 'Function'
            ? (options.auth.password(cred) as boolean)
            : await options.auth.password(cred)

        await writer.write(authGranted(granted))
        state = granted //
          ? ConnectionState.ClientRequest
          : ConnectionState.Close
      }
    } else if (state === ConnectionState.ClientRequest) {
      const view = new DataView(c.buffer)

      // VER
      if (view.getUint8(0) !== VER) {
        state = ConnectionState.Close
        await writer.write(acceptConn('GeneralFailure'))
        await writer.close()
        return
      }
      // CMD
      if (view.getUint8(1) !== CLIENT_CMD.TCP_IP_StreamConnection) {
        state = ConnectionState.Close
        await writer.write(acceptConn('ConnectionNotAllowedByRuleset'))
        await writer.close()
        return
      }
      // RSV
      if (view.getUint8(2) !== RSV) {
        state = ConnectionState.Close
        await writer.write(acceptConn('GeneralFailure'))
        await writer.close()
        return
      }

      // DSTADDR + DSTPORT
      const addr = parseSocks5Addr(new Uint8Array(c.buffer, 4))
      if (!addr) {
        writer.releaseLock()
        await writer.close()
        throw new Error('Conn close')
      }

      const _localPort = new Uint8Array([(localPort >> 8) & 0xff, localPort & 0xff])
      try {
        const distConn = await Deno.connect(addr)

        // accept conn
        await writer.write(
          new Uint8Array([
            VER,
            SERVER_RES.RequestGranted,
            RSV,
            CLIENT_ADDR_TYPE.IPv4,
            ...bndAddr,
            ..._localPort,
          ])
        )

        state = ConnectionState.Open
        return {
          state,
          addr,
          distConn,
        }
      } catch (e) {
        if (e instanceof Deno.errors.ConnectionAborted) {
          console.log(e)
        }
      }
    }
  }
}

// TEST
const bndAddr = getBndAddr() // [127, 0, 0, 1]

serveTcp({port: 40443}, async (conn) => {
  try {
    const socks5 = await acceptSocks5(conn, conn.localAddr.port, {
      noAuth: true,
      auth: {
        password(cred) {
          return true
        },
      },
    })
    if (!socks5) throw new Error('SOCKS5 err')
    // if (socks5.state === ConnectionState.Close) throw new Error('Socks5 closed')

    console.log(
      `${ConnectionState[socks5.state]} %c${conn.remoteAddr.hostname} %c-> %c${
        socks5.distConn.remoteAddr.hostname
      }`,
      'color: green',
      'color: inherit',
      'color: orange'
    )
    const {distConn} = socks5

    const res = await Promise.all([copy(conn, distConn), copy(distConn, conn)]).catch((e) => {
      if (e instanceof Deno.errors.ConnectionReset) {
        console.error(e.message)
      } else {
        console.error(e)
      }
    })

    if (res) console.log('close conn', {tx: res[0], rx: res[1]})
    else console.log('close conn')
  } catch (e) {
    if (e instanceof Error) {
      console.error(e.message)
    } else {
      console.error(e)
    }
  }
})
