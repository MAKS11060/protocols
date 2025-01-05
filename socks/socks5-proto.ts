#!/usr/bin/env -S deno run -A --watch-hmr

import {copy} from 'jsr:@std/io/copy'
import {printBuf} from '../deps.ts'
import {serveTcp} from '../utils.ts'
import {getBndAddr} from './utils.ts'

const VER = 0x05
const RSV = 0x00

// const AUTH = {
//   NoAuth: 0x00,
//   Password: 0x02,
// } as const

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

//
const bndAddr = getBndAddr()

// TEST
// 1 <-
const clientHello = new Uint8Array([VER, 1, AUTH.NoAuth])
const clientHelloWithPassword = new Uint8Array([VER, 1, AUTH.Password])

// 2 ->
const serverHello = new Uint8Array([VER, AUTH.NoAuth])

// 2.1 ->
const serverHelloWithPassword = new Uint8Array([VER, AUTH.Password])
// 2.1 <-
const _username = new TextEncoder().encode('root')
const _password = new TextEncoder().encode('admin')
const clientPassword = new Uint8Array([
  0x1,
  _username.byteLength,
  ..._username,
  _password.byteLength,
  ..._password,
])
// console.log(parseAuthPassword(clientPassword))

// 3
const clientRequest = new Uint8Array([
  VER,
  CLIENT_CMD.TCP_IP_StreamConnection,
  RSV,
  CLIENT_ADDR_TYPE.IPv4,
])

//
export const parseSocks5Addr = (c: Uint8Array) => {
  const view = new DataView(c.buffer, 3)
  const type = view.getUint8(0) as ADDR_TYPE
  if (!ADDR_TYPE[type]) throw new Error('Invalid ADDR type')

  if (type === ADDR_TYPE.IPv4) {
    return {
      transport: 'tcp',
      hostname: `${view.getUint8(1)}.${view.getUint8(2)}.${view.getUint8(3)}.${view.getUint8(4)}`,
      port: view.getUint16(5),
    } satisfies Deno.NetAddr & {transport: 'tcp'}
  } else if (type === ADDR_TYPE.IPv6) {
    return false
  } else if (type === ADDR_TYPE.DomainName) {
    const len = view.getUint8(1)
    return {
      transport: 'tcp',
      hostname: new TextDecoder().decode(view.buffer.slice(1, 1 + len)),
      port: view.getUint16(1 + len),
    } satisfies Deno.NetAddr & {transport: 'tcp'}
  }

  throw new Error('Invalid ADDR type')
}
//
enum ConnectionState {
  clientHello,
  ClientAuth,
  ClientRequest,
  Close,
  Open,
}

const initSocks5 = (localAddr: Deno.NetAddr, conn: Deno.TcpConn) => {
  let state: ConnectionState = ConnectionState.clientHello
  let addr: {transport: 'tcp'; hostname: string; port: number} | false

  return new TransformStream<Uint8Array, Uint8Array | Deno.TcpConn>({
    async transform(c, controller) {
      if (state === ConnectionState.clientHello) {
        controller.enqueue(new Uint8Array([VER, AUTH.NoAuth]))
        state = ConnectionState.ClientRequest
      } else if (state === ConnectionState.ClientAuth) {
        // controller.enqueue(new Uint8Array([]))
        state = ConnectionState.ClientRequest
      } else if (state === ConnectionState.ClientRequest) {
        const view = new DataView(c.buffer)

        // VER
        if (view.getUint8(0) !== VER) {
          state = ConnectionState.Close
          controller.terminate()
          return
        }
        // CMD
        if (view.getUint8(1) !== CLIENT_CMD.TCP_IP_StreamConnection) {
          state = ConnectionState.Close
          controller.terminate()
          return
        }

        // DSTADDR + DSTPORT
        addr = parseSocks5Addr(new Uint8Array(c.buffer, 4))
        if (addr === false) {
          const addrType = view.getUint8(0) as ADDR_TYPE
          controller.enqueue(
            new Uint8Array([VER, SERVER_RES.AddressTypeNotSupported, RSV, addrType])
          )
          state = ConnectionState.Close
          controller.terminate()
          return
        }

        // Accept
        const localPort = new Uint8Array(2)
        new DataView(localPort.buffer).setUint16(0, localAddr.port)

        // server response
        controller.enqueue(
          new Uint8Array([
            VER,
            SERVER_RES.RequestGranted,
            RSV,
            CLIENT_ADDR_TYPE.IPv4,
            ...bndAddr,
            ...localPort,
          ])
        )

        // distConn.writable
        state = ConnectionState.Open
      } else if (state === ConnectionState.Open) {
        if (!addr) throw new Error('Addr not set')

        let distConn = await Deno.connect(addr)
        for await (const data of distConn.readable.values()) {
          controller.enqueue(data)
        }
      }
    },
  })
}

export const acceptSocks5 = async (conn: Deno.TcpConn) => {
  let state: ConnectionState = ConnectionState.clientHello

  const writer = conn.writable.getWriter()
  // const writable = new WritableStream<Uint8Array>({
  //   async write(c, controller) {
  //     printBuf(c)

  //     await writer.write()

  //   },
  // })
  // await conn.readable.pipeTo(writable)

  for await (const c of conn.readable.values({preventCancel: true})) {
    // printBuf(c)
    if (state === ConnectionState.clientHello) {
      await writer.write(new Uint8Array([VER, AUTH.NoAuth]))
      state = ConnectionState.ClientRequest
    } else if (state === ConnectionState.ClientRequest) {
      const view = new DataView(c.buffer)

      // VER
      if (view.getUint8(0) !== VER) {
        state = ConnectionState.Close
        await writer.close()
        return
      }
      // CMD
      if (view.getUint8(1) !== CLIENT_CMD.TCP_IP_StreamConnection) {
        state = ConnectionState.Close
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

      const localPort = new Uint8Array([
        (conn.localAddr.port >> 8) & 0xff,
        conn.localAddr.port & 0xff,
      ])

      const distConn = await Deno.connect(addr)

      //
      await writer.write(
        new Uint8Array([
          VER,
          SERVER_RES.RequestGranted,
          RSV,
          CLIENT_ADDR_TYPE.IPv4,
          ...bndAddr,
          ...localPort,
        ])
      )

      state = ConnectionState.Open

      return {
        state,
        addr,
        distConn,
      }
    }
  }

  throw new Error('Read error')
}

serveTcp({port: 40443}, async (conn) => {
  try {
    const socks5 = await acceptSocks5(conn)
    if (!socks5) throw new Error('Socks5 failed')
    const {distConn} = socks5

    await Promise.all([
      // Bind src to dist
      copy(conn, distConn),
      // Bind dist to src
      copy(distConn, conn),
    ]).catch((e) => {
      if (e instanceof Deno.errors.ConnectionReset) {
        console.error(e.message)
      } else {
        console.error(e)
      }
    })

    // const socks = initSocks5(conn.localAddr, conn)
    // await Promise.all([
    //   //
    //   conn.readable.pipeTo(socks.writable, {preventClose: true}),
    //   socks.readable.pipeTo(conn.writable, {preventClose: true}),
    // ])
    console.log('close conn')
  } catch (e) {
    if (e instanceof Error) {
      console.error(e.message)
    } else {
      console.error(e)
    }
  }
})

/* {
  const writer = socks.writable.getWriter()
  writer.write(clientHello)

  const iter = socks.readable.values()
  console.log(await iter.next())

  writer.write(clientRequest)
  console.log(await iter.next())
} */

// const data = new Uint8Array([0,1,2,3,4,5,6,7,8,9])
// printBuf(data)
// printBuf(new Uint8Array(data.buffer, 2))

/* {
  const toConsole = () => {
    return new WritableStream({
      write(c) {
        console.log(c)
      },
      close() {
        console.log('close')
      },
    })
  }

  const toConsolePass = (prefix: string = '') => {
    return new TransformStream({
      transform(c, controller) {
        console.log(prefix, c)
        controller.enqueue(c)
      },
    })
  }

  const readableStream1 = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0]))
      controller.close()
    },
  })
  const readableStream2 = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1]))
      controller.error()
    },
  })
  const readableStream3 = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([2]))
      controller.close()
    },
  })

  const writable = toConsole()
  await readableStream1.pipeTo(writable, {preventClose: true})
  await readableStream2.pipeTo(writable, {preventClose: true})
  await readableStream3.pipeTo(writable)
}
 */
