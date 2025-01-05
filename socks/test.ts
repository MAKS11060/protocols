#!/usr/bin/env -S deno run -A --watch-hmr

import {copy} from 'jsr:@std/io/copy'
import {serveTcp} from '../utils.ts'
import {ConnectionState} from './enum.ts'
import {acceptSocks5} from './socks5-server.ts'
import {getBndAddr} from "./utils.ts"

const bndAddr = getBndAddr() // [127, 0, 0, 1]

serveTcp({port: 40443}, async (conn) => {
  try {
    const socks5 = await acceptSocks5(conn, bndAddr, conn.localAddr.port /* 40443 ??? */, {
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
