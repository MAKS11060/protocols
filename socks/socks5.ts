/**
 * @author MAKS11060
 *
 * Implementation of a SOCKS5 server.
 * Based on WebStream API
 *
 * RFC: https://datatracker.ietf.org/doc/html/rfc1928
 *
 * https://en.wikipedia.org/wiki/SOCKS#SOCKS5
 */

import {ADDR_TYPE, AUTH, CLIENT_CMD, ConnectionState, RSV, SERVER_REPLIES, VER} from './enum.ts'
import {parseAuthPassword, parseSocks5Addr} from './utils.ts'

const acceptAuthMethod = (authType: AUTH | number = 0xff) => new Uint8Array([VER, authType])

const authGranted = (status = true) => new Uint8Array([0x01, status ? 0x00 : 0x01])

const acceptConn = (
  options:
    | {
        type: SERVER_REPLIES.Succeeded
        addrType: ADDR_TYPE
        bndAddr: Uint8Array
        bndPort: Uint8Array
      }
    | {
        type: Exclude<SERVER_REPLIES, SERVER_REPLIES.Succeeded>
      }
) => {
  if (options.type === SERVER_REPLIES.Succeeded) {
    return new Uint8Array([
      VER,
      options.type,
      RSV,
      options.addrType,
      ...options.bndAddr,
      ...options.bndPort,
    ])
  }

  return new Uint8Array([VER, options.type])
}

export const upgradeSocks5 = async (
  conn: TransformStream<Uint8Array, Uint8Array>,
  bnd: {
    addr: Uint8Array
    port: Uint8Array
  },
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

      // VER
      if (view.getUint8(0) !== VER) {
        state = ConnectionState.Close
        await writer.write(acceptConn({type: SERVER_REPLIES.CommandNotSupported}))
        await writer.close()
        return
      }

      // TODO
      // AuthN
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
        await writer.write(acceptConn({type: SERVER_REPLIES.CommandNotSupported}))
        await writer.close()
        return
      }
      // CMD
      if (view.getUint8(1) !== CLIENT_CMD.Connect) {
        state = ConnectionState.Close
        await writer.write(acceptConn({type: SERVER_REPLIES.CommandNotSupported})) // only tcp
        await writer.close()
        return
      }
      // RSV
      if (view.getUint8(2) !== RSV) {
        state = ConnectionState.Close
        await writer.write(acceptConn({type: SERVER_REPLIES.CommandNotSupported}))
        await writer.close()
        return
      }

      // DSTADDR + DSTPORT
      const addr = parseSocks5Addr(new Uint8Array(c.buffer, 4))
      if (!addr) {
        // writer.releaseLock()
        await writer.close()
        throw new Error('Conn close')
      }

      try {
        const distConn = await Deno.connect(addr)
        await writer.write(
          acceptConn({
            type: SERVER_REPLIES.Succeeded,
            addrType: ADDR_TYPE.IPv4,
            bndAddr: bnd.addr,
            bndPort: bnd.port,
          })
        )

        state = ConnectionState.Open
        return {
          state,
          addr,
          distConn,
        }
      } catch (e) {
        await writer.write(acceptConn({type: SERVER_REPLIES.HostUnreachable}))
        if (e instanceof Deno.errors.ConnectionAborted) {
          console.log(e)
        }
      }
    }
  }
}
