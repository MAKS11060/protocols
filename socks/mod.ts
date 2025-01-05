#!/usr/bin/env -S deno run -A --watch-hmr

import {printBuf} from '../deps.ts'
import {AUTH, CLIENT, SERVER} from './enum.ts'
import {parseAuthPassword} from './utils.ts'

type EnumToRecord<T = {}> = {
  [K in keyof T]: T[K] extends number ? number : never
}

const clientGreeting = (data: DataView) => {
  if (data.getUint8(0) === CLIENT.VER) {
    return true
  }
}

const clientAuth = (data: DataView) => {
  printBuf(data.buffer, {rowLimit: 2})
  const nAuth = data.getUint8(0)

  // const res: Record<keyof typeof AUTH, boolean> = {}
  // for (let i = 2; i < 2 + nAuth; i++) {
  //   res[''] = true
  // }

  return new Array(nAuth).fill(undefined).map((_, i) => {
    return AUTH[data.getUint8(i + 2)] ?? AUTH.no_supported
  }) as (keyof typeof AUTH)[]
}

const serverGreeting = (type: keyof typeof AUTH) => {
  if (type === 'Password') {
    return new Uint8Array([SERVER.VER, AUTH[type]])
  }

  return new Uint8Array([SERVER.VER, AUTH[type] ?? 0xff])
}

/* type AuthCheck = {type: 'Password', data: {username: string; password: string}}

const authCheck = async <T extends AuthCheck>(
  type: T,
  validate: (data: ) => Promise<boolean>
) => {}

authCheck('Password', v => {}) */

const authAllow = () => new Uint8Array([0x01, 0x00])
const authDenied = () => new Uint8Array([0x01, 0x01])

const readClientRequest = (data: DataView) => {
  if (data.getUint8(0) !== CLIENT.VER) return
  if (data.getUint8(1) !== 0x01) return
}

export const handleConnection = async (conn: Deno.TcpConn) => {
  const buf = new Uint8Array(256)

  let n = await conn.read(buf) // read to buf
  if (!n) return conn.close()

  // Read client greeting
  if (!clientGreeting(new DataView(buf.buffer, 0))) {
    conn.close()
  }

  // Read client auth
  const auth = clientAuth(new DataView(buf.buffer, 1))
  console.log({auth})
  for (const method of auth) {
    if (method === 'NoAuthentication') {
      await conn.write(serverGreeting(method))
      break
    }
    if (method === 'Password') {
      await conn.write(serverGreeting(method))

      n = await conn.read(buf)
      const cred = parseAuthPassword(buf)
      console.log({cred})

      await conn.write(authAllow())

      break
    }
  }

  // Read client request
  n = await conn.read(buf)

  readClientRequest(new DataView(buf.buffer))
}

// TEST
const listener = Deno.listen({port: 40443})
console.error('Socks5 listening on 40443')

!(async () => {
  for await (const conn of listener) {
    handleConnection(conn).catch((e) => {
      console.error(e)
    })
  }
})()
