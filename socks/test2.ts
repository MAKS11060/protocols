#!/usr/bin/env -S deno run -A --watch-hmr

import {copy} from 'jsr:@std/io/copy'
import {printBuf} from '../deps.ts'

const toConsole = () =>
  new WritableStream({
    write(c) {
      console.log(c)
    },
  })

const toConsolePass = (prefix: string = '') =>
  new TransformStream({
    transform(c, controller) {
      console.log(prefix, c)
      controller.enqueue(c)
    },
  })

const range = () =>
  new ReadableStream({
    pull(controller) {
      for (let i = 0; i < 10; i++) {
        controller.enqueue(i)
      }
      controller.close()
    },
  })

export const serveTcp = async (
  options: Deno.TcpListenOptions,
  handler: (conn: Deno.TcpConn) => void
) => {
  const listener = Deno.listen(options)
  for await (const conn of listener) {
    try {
      handler(conn)
    } catch (e) {
      console.error(e)
    }
  }
}

//
const bndAddr = new Uint8Array(4)
for (const {address} of Deno.networkInterfaces()) {
  if (address === '127.0.0.1') {
    bndAddr.set(address.split('.').map((octet) => parseInt(octet)))
    break
  }
}

//
const SOCKS_VER = 0x05 // 5
const RSV = 0x00

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

const acceptAuthMethod = (authType: number = 0xff) => {
  return new Uint8Array([SOCKS_VER, authType])
}

const authAllow = () => new Uint8Array([0x01, 0x00])
const authDenied = () => new Uint8Array([0x01, 0x01])

serveTcp({port: 40443}, async (conn) => {
  let step = 0
  const sock = new TransformStream<Uint8Array>(
    {
      async transform(chunk, controller) {
        printBuf(chunk, {rowLimit: 2})

        const view = new DataView(chunk.buffer)
        if (step === 0) {
          if (view.getUint8(0) !== SOCKS_VER) {
            return controller.terminate()
          }

          // Auth data
          const nAuth = view.getUint8(1)
          for (let i = 2; i < nAuth + 2; i++) {
            switch (view.getUint8(i)) {
              case 0:
                // NoAuthentication
                await controller.enqueue(acceptAuthMethod(0))
                break
              default:
                await controller.enqueue(acceptAuthMethod())
                controller.terminate()
                return
            }
          }

          step = 1
        } else if (step === 1) {
          if (view.getUint8(0) !== SOCKS_VER) {
            controller.terminate()
            return
          }

          if (view.getUint8(1) !== CLIENT_CMD.TCP_IP_StreamConnection) {
            controller.terminate()
            return
          }

          const addrType = view.getUint8(3)
          let addr: Deno.NetAddr & {transport: 'tcp'}
          if (addrType === CLIENT_ADDR_TYPE.IPv4) {
            addr = {
              transport: 'tcp',
              hostname: `${view.getUint8(4)}.${view.getUint8(5)}.${view.getUint8(
                6
              )}.${view.getUint8(7)}`,
              port: view.getUint16(8),
            }
          } else if (addrType === CLIENT_ADDR_TYPE.DomainName) {
            const len = view.getUint8(4)
            addr = {
              transport: 'tcp',
              hostname: new TextDecoder().decode(view.buffer.slice(5, 5 + len)),
              port: view.getUint16(5 + len),
            }
          } else {
            controller.enqueue(
              new Uint8Array([SOCKS_VER, SERVER_RES.AddressTypeNotSupported, RSV, addrType])
            )
            controller.terminate()
            return
          }
          // controller.terminate()

          /*
          try {
            let distConn = await Deno.connect(addr)

            const localPort = new Uint8Array(2)
            new DataView(localPort.buffer).setUint16(0, conn.localAddr.port)

            // server response
            controller.enqueue(
              new Uint8Array([
                SOCKS_VER,
                SERVER_RES.RequestGranted,
                RSV,
                CLIENT_ADDR_TYPE.IPv4,
                ...bndAddr,
                ...localPort,
              ])
            )

          } catch (e) {
            controller.enqueue(
              new Uint8Array([
                SOCKS_VER,
                SERVER_RES.ConnectionRefusedByDestinationHost,
                RSV,
                addrType,
              ])
            )
            controller.terminate()
            console.error(e)
            return
          } */
        }
      },
      // start(controller) {
      //   console.log('start')
      //   controller.enqueue(new Uint8Array(0))
      // },
    },
    {highWaterMark: 1}
  )

  await Promise.all([
    //
    conn.readable.pipeThrough(toConsolePass('CONN')).pipeTo(sock.writable),
    sock.readable.pipeThrough(toConsolePass('SOCK')).pipeTo(conn.writable),
  ])
  console.log('end')
})

serveTcp({port: 40444}, async (conn) => {
  // console.log('conn')
  const buf = new Uint8Array(256)
  let n = await conn.read(buf)
  if (!n) return conn.close()

  let view = new DataView(buf.buffer)
  // printBuf(view.buffer, {rowLimit: 1})

  // client greeting
  if (view.getUint8(0) !== SOCKS_VER) {
    return conn.close()
  }

  // Auth data
  const nAuth = view.getUint8(1)
  for (let i = 2; i < nAuth + 2; i++) {
    switch (view.getUint8(i)) {
      case 0:
        // NoAuthentication
        await conn.write(acceptAuthMethod(0))
        break
      default:
        await conn.write(acceptAuthMethod())
        conn.close()
        return
    }
  }

  n = await conn.read(buf)
  // client request
  if (view.getUint8(0) !== SOCKS_VER) {
    conn.close()
    return
  }

  if (view.getUint8(1) !== CLIENT_CMD.TCP_IP_StreamConnection) {
    conn.close()
    return
  }

  const addrType = view.getUint8(3)
  let addr: Deno.NetAddr & {transport: 'tcp'}
  if (addrType === CLIENT_ADDR_TYPE.IPv4) {
    addr = {
      transport: 'tcp',
      hostname: `${view.getUint8(4)}.${view.getUint8(5)}.${view.getUint8(6)}.${view.getUint8(7)}`,
      port: view.getUint16(8),
    }
  } else if (addrType === CLIENT_ADDR_TYPE.DomainName) {
    const len = view.getUint8(4)
    addr = {
      transport: 'tcp',
      hostname: new TextDecoder().decode(view.buffer.slice(5, 5 + len)),
      port: view.getUint16(5 + len),
    }
  } else {
    await conn.write(new Uint8Array([SOCKS_VER, SERVER_RES.AddressTypeNotSupported, RSV, addrType]))
    conn.close()
    return
  }

  // console.log({addr})

  let distConn: Deno.TcpConn
  try {
    distConn = await Deno.connect(addr)
  } catch (e) {
    await conn.write(
      new Uint8Array([SOCKS_VER, SERVER_RES.ConnectionRefusedByDestinationHost, RSV, addrType])
    )
    conn.close()
    return
  }

  // conn
  const localPort = new Uint8Array(2)
  new DataView(localPort.buffer).setUint16(0, conn.localAddr.port)

  // server response
  await conn.write(
    new Uint8Array([
      SOCKS_VER,
      SERVER_RES.RequestGranted,
      RSV,
      CLIENT_ADDR_TYPE.IPv4,
      ...bndAddr,
      ...localPort,
    ])
  )

  console.log(
    `conn: %c${conn.remoteAddr.hostname} %c=> %c${addr.hostname}`,
    'color: orange',
    'color: inherit',
    'color: orange'
  )

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

  conn.close()
})
