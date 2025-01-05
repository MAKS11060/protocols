#!/usr/bin/env -S deno run -A --watch-hmr

import {copy} from 'jsr:@std/io/copy'
import {serveTcp} from '../utils.ts'
import {ConnectionState} from './enum.ts'
import {upgradeSocks5} from './socks5.ts'
import {bndAddr, bndAddrFromNetAddr} from './utils.ts'

const bnd = bndAddr('127.0.0.1', 40443)
console.log(bnd)

serveTcp({port: 40443}, async (conn) => {
  try {
    const socks5 = await upgradeSocks5(conn, bndAddrFromNetAddr(conn.localAddr))

    console.log(
      `${ConnectionState[socks5.state]} %c${conn.remoteAddr.hostname} %c-> %c${
        socks5.distConn.remoteAddr.hostname
      }`,
      'color: green',
      'color: inherit',
      'color: orange'
    )

    const metric = await Promise.all([
      // client -> server
      copy(conn, socks5.distConn),
      // server -> client
      copy(socks5.distConn, conn),
    ])
    metric // Statistic
      ? console.log('close conn', {RX: metric[1], TX: metric[0]})
      : console.log('close conn')
  } catch (e) {
    if (e instanceof Deno.errors.ConnectionReset) {
      console.error(e.message)
    } else if (e instanceof Error) {
      console.error(e.message)
    } else {
      console.error(e)
    }
  }
})
