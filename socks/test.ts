#!/usr/bin/env -S deno run -A --watch-hmr

/*
  CLIENT Client greeting
0   0x05   VER
1   0x01   n auth methods
2+n   0x00 No Authorization
      0x02 Password

  SERVER Choice

      0x01 ver
        0x00 username len
          0x00 username
        0x00 password len
          0x00 password

  SERVER
0   0x05 VER
1   0x00 Auth method
1   0xff Access denied

*/

import { copy } from "jsr:@std/io/copy";
import {serveTcp} from '../utils.ts'

enum Status {
  ClientGreeting,
  ServerChoice,
}

enum AuthMethods {
  NoAuthentication = 0x00,
  Password = 0x02,
}

const SOCKS5_VER = 0x05

const toConsole = () =>
  new WritableStream({
    write(c) {
      console.log(c)
    },
  })

type AuthMethod = keyof typeof AuthMethods

type Options =
  | {
      auth: 'NoAuthentication'
    }
  | {
      auth: 'Password'
      validate: (cred: {username: string; password: string}) => boolean
    }

const handle = async (options: Options) => {
  let step: Status = Status.ClientGreeting

  type Output = {
    type: 'clientGreeting'
    authMethods: ('NoAuthentication' | 'Password')[]
  }

  return new TransformStream<Uint8Array, Output>({
    transform(chunk, controller) {
      console.log(chunk)
      if (step === Status.ClientGreeting) {
        const view = new DataView(chunk.buffer)

        if (view.getUint8(0) !== SOCKS5_VER) {
          controller.error('VER unknown')
          return
        }

        const nAuth = view.getUint8(1)
        const authMethods: AuthMethod[] = []
        for (let i = 0; i < nAuth; i++) {
          authMethods.push(AuthMethods[view.getUint8(i + 2)] as keyof typeof AuthMethods)
        }

        controller.enqueue({type: 'clientGreeting', authMethods})
      }
    },
  })
}

// const socks5 = await handle({auth: 'NoAuthentication'})
// socks5.readable.pipeTo(toConsole())

// const writer = socks5.writable.getWriter()
// // clientGreeting
// await writer.write(new Uint8Array([0x05, 0x01, 0x00]))

type HandleOptions = {
  auth?: {
    noAuth?: boolean
    password?: (cred: {username: string; password: string}) => Promise<boolean> | boolean
  }
}

const handleSocks5 = async (conn: Deno.Conn<Deno.Addr>, options: HandleOptions) => {
  const handShake = new TransformStream({})


  

  // try {
  //   await Promise.all([
  //     // Proxy data between client and target server
  //     copy(conn, targetConn),
  //     copy(targetConn, conn),
  //   ])
  // } catch (e: any) {
  //   console.error(`error from: ${conn.remoteAddr.hostname} to ${addr}:${port}`, e.name, e.code)
  // }

  // conn.close()
  // targetConn.close()

}

serveTcp({port: 40443}, async (conn) => {
  const socks = await handleSocks5(conn, {})
})
