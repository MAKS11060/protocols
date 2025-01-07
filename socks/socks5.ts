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
import {isLocalAddr, parseAuthPassword, parseSocks5Addr} from './utils.ts'

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

interface Socks5UpgradeOptions {
  /** @default true */
  restrictLocal?: boolean
  password?: (cred: {username: string; password: string}) => Promise<boolean> | boolean
  noAuth?: boolean
}

export const upgradeSocks5 = async (
  conn: TransformStream<Uint8Array, Uint8Array>,
  bnd: {
    addr: Uint8Array
    port: Uint8Array
  },
  options?: Socks5UpgradeOptions
) => {
  options ??= {}
  options.restrictLocal ??= true
  options.noAuth ??= !options.password

  const writer = conn.writable.getWriter()

  let state: ConnectionState = ConnectionState.ClientHello
  let authMethods: AUTH[] = []
  // let authMethod: AUTH | undefined // TODO: used for more authentication methods

  for await (const c of conn.readable.values({preventCancel: true})) {
    // console.log(`state: %c${ConnectionState[state]}`, 'color: orange')
    if (state === ConnectionState.Close) break
    if (state === ConnectionState.ClientHello) {
      const view = new DataView(c.buffer)

      // VER
      if (view.getUint8(0) !== VER) {
        state = ConnectionState.Close
        await writer.write(acceptConn({type: SERVER_REPLIES.CommandNotSupported}))
        await writer.close()
        throw new Error('SOCKS5 Upgrade failed')
      }

      // AuthN
      const authN = view.getUint8(1) // auth methods count
      for (let i = 0; i < authN; i++) {
        const method = view.getUint8(i + 2)
        if (AUTH[method]) authMethods.push(method)
      }

      // Choice auth
      if (options.noAuth && authMethods.includes(AUTH.NoAuth)) {
        await writer.write(acceptAuthMethod(AUTH.NoAuth))
        state = ConnectionState.ClientRequest
      }
      // Use password
      else if (options.password && authMethods.includes(AUTH.Password)) {
        await writer.write(acceptAuthMethod(AUTH.Password))
        state = ConnectionState.ClientAuth
      }
      // Not supported auth methods
      else {
        await writer.write(acceptAuthMethod())
        state = ConnectionState.Close
      }
    } else if (state === ConnectionState.ClientAuth) {
      // skip any methods
      if (options.noAuth) {
        await writer.write(authGranted())
        state = ConnectionState.ClientRequest
      }
      // Check password
      else if (options.password && authMethods.includes(AUTH.Password)) {
        const cred = parseAuthPassword(c)
        const granted =
          options.password.constructor.name === 'Function'
            ? (options.password(cred) as boolean)
            : await options.password(cred)

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
        throw new Error('SOCKS5 Upgrade failed')
      }
      // CMD
      if (view.getUint8(1) !== CLIENT_CMD.Connect) {
        state = ConnectionState.Close
        await writer.write(acceptConn({type: SERVER_REPLIES.CommandNotSupported})) // only tcp
        await writer.close()
        throw new Error('SOCKS5 Upgrade failed')
      }
      // RSV
      if (view.getUint8(2) !== RSV) {
        state = ConnectionState.Close
        await writer.write(acceptConn({type: SERVER_REPLIES.CommandNotSupported}))
        await writer.close()
        throw new Error('SOCKS5 Upgrade failed')
      }

      // DST.ADDR + DST.PORT
      const addr = parseSocks5Addr(c)
      if (!addr) {
        // writer.releaseLock()
        await writer.close()
        throw new Error('SOCKS5 Parse addr error')
      }

      // console.log(addr)
      // if (addr.type === ADDR_TYPE.IPv6) {
      //   throw new Error('SOCKS5 Upgrade failed', {cause: 'IPv6 addr not supported'})
      // }

      try {
        const distConn =
          addr.type === ADDR_TYPE.IPv6 // Not tested
            ? await Deno.connect({...addr, hostname: `[${addr.hostname}]`}) // wrap IPv6
            : await Deno.connect(addr)

        if (options.restrictLocal && isLocalAddr(distConn.remoteAddr)) {
          console.error(
            `%cRestrict: ${distConn.remoteAddr.hostname} to ${addr.hostname}:${addr.port}`,
            'color:red'
          )
          distConn.close()
          state = ConnectionState.Close
          await writer.write(acceptConn({type: SERVER_REPLIES.ConnectionNotAllowedByRuleset}))
          throw new Error('SOCKS5 Upgrade failed', {cause: 'ConnectionNotAllowedByRuleset'})
        }

        await writer.write(
          acceptConn({
            type: SERVER_REPLIES.Succeeded,
            addrType: ADDR_TYPE.IPv4,
            bndAddr: bnd.addr,
            bndPort: bnd.port,
          })
        )

        state = ConnectionState.Open

        return {state, addr, distConn}
      } catch (e) {
        state = ConnectionState.Close
        await writer.write(acceptConn({type: SERVER_REPLIES.HostUnreachable}))
        if (e instanceof Error) {
          console.error(e.name, e.message)
        }
      }
    }
  }

  throw new Error('SOCKS5 Upgrade failed', {cause: 'Readable end'})
}
