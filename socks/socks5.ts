#!/usr/bin/env -S deno run -A --unstable-hmr

/*
  https://en.wikipedia.org/wiki/SOCKS
  https://ru.wikipedia.org/wiki/SOCKS
*/

import {copy} from 'jsr:@std/io'
import {isLocalAddr, parseAuthPassword} from './utils.ts'

// cfg
export const ENABLE_AUTH = true
export const LOCAL_WITHOUT_AUTH = true // 127.0.0.1 192.168.100.*
export const RESTRICT_LOCAL = true // 127.0.0.1 192.168.100.*

export const passwd = new Map<string, string>()

if (!ENABLE_AUTH) passwd.set('', '')

passwd.set('4ae1d8bfa6bd45d8', 'b4d7-8d453c61c25b')


const bndAddr = new Uint8Array(4)
for (const {address} of Deno.networkInterfaces()) {
  if (address === '127.0.0.1') {
    bndAddr.set(address.split('.').map((octet) => parseInt(octet)))
    break
  }
}

enum AUTH_METHODS {
  NoAuthentication = 0x00,
  Password = 0x02,
  no_supported = 0xff,
}

enum CLIENT {
  VER = 0x05 //
}

// const listener = Deno.listen({port: 80})
const listener = Deno.listen({port: 40443})
console.error('Socks5 listening on 40443')

for await (const conn of listener) {
  handleConnection(conn).catch((e) => {
    console.error(e)
  })
}

async function handleConnection(conn: Deno.TcpConn) {
  const buf = new Uint8Array(256)

  // Read client greeting
  let n = await conn.read(buf)
  if (buf.at(0) !== CLIENT.VER) {
    conn.close()
    return
  }

  // Send server greeting
  // await conn.write(new Uint8Array([0x05, 0x00]))

  // Send server greeting
  const methods = buf.subarray(2, n!)
  let method: number
  if (methods.includes(AUTH_METHODS.NoAuthentication) && !ENABLE_AUTH) {
    method = AUTH_METHODS.NoAuthentication
  } else if (methods.includes(AUTH_METHODS.Password)) {
    method = AUTH_METHODS.Password
  } else {
    method = AUTH_METHODS.no_supported
  }

  if (LOCAL_WITHOUT_AUTH && isLocalAddr(conn)) {
    method = AUTH_METHODS.NoAuthentication
  }

  // console.log(`auth method: ${AUTH_METHODS[method]}`, buf.slice(0, 16))
  await conn.write(new Uint8Array([0x05, method]))
  if (method === AUTH_METHODS.no_supported) {
    conn.close()
    return
  }

  // Perform authentication if required
  if (method === AUTH_METHODS.Password) {
    const n = await conn.read(buf)

    const cred = parseAuthPassword(buf)
    if (passwd.get(cred.username) !== cred.password) {
      console.error(`${conn.remoteAddr.hostname} login failed: ${cred.username}:${cred.password}`)
      await conn.write(new Uint8Array([0x01, 0x01]))
      conn.close()
      return
    }

    await conn.write(new Uint8Array([0x01, 0x00])) // success
  }

  // Read client request
  n = await conn.read(buf)
  if (buf[1] !== 0x01) {
    conn.close()
    return
  }

  const atyp = buf[3]
  let addr: string
  let port: number
  if (atyp === 0x01) {
    // IPv4 address
    addr = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`
    port = (buf[8] << 8) | buf[9]
  } else if (atyp === 0x03) {
    // Domain name
    const len = buf[4]
    addr = new TextDecoder().decode(buf.subarray(5, 5 + len))
    port = (buf[5 + len] << 8) | buf[6 + len]
  } else {
    // Unsupported address type
    await conn.write(new Uint8Array([0x05, 0x08, 0x00, atyp]))
    conn.close()
    return
  }

  // Connect to target server
  let targetConn: Deno.TcpConn
  try {
    targetConn = await Deno.connect({hostname: addr, port})
    if (RESTRICT_LOCAL && isLocalAddr(targetConn)) {
      console.error(`Restrict: ${conn.remoteAddr.hostname} to ${addr}:${port}`)
      targetConn.close()
      await conn.write(new Uint8Array([0x05, 0x02]))
      conn.close()
      return
    }
  } catch (e) {
    await conn.write(new Uint8Array([0x05, 0x05, 0x00, atyp]))
    conn.close()
    return
  }

  const localPort = new Uint8Array(2) // [00, 80]
  new DataView(localPort.buffer).setUint16(0, conn.localAddr.port)

  await conn.write(new Uint8Array([0x05, 0x00, 0x00, 0x01, ...bndAddr, ...localPort]))

  console.log(`conn from: ${conn.remoteAddr.hostname} to ${addr}:${port}`)
  try {
    await Promise.all([
      // Proxy data between client and target server
      copy(conn, targetConn),
      copy(targetConn, conn),
    ])
  } catch (e: any) {
    console.error(`error from: ${conn.remoteAddr.hostname} to ${addr}:${port}`, e.name, e.code)
  }

  conn.close()
  targetConn.close()
}
