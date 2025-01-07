#!/usr/bin/env -S deno run -A --watch-hmr

import {copy} from 'jsr:@std/io/copy'
import {serveTcp} from '../utils.ts'
import {ConnectionState} from './enum.ts'
import {upgradeSocks5} from './socks5.ts'
import {bndAddr} from './utils.ts'

const bnd = bndAddr('127.0.0.1', 40443)
// console.log(bnd)

serveTcp({port: 40443}, async (conn) => {
  try {
    // const socks5 = await upgradeSocks5(conn, bndAddrFromNetAddr(conn.localAddr))
    // const socks5 = await upgradeSocks5(conn, bnd)
    const socks5 = await upgradeSocks5(conn, bnd, {
      noAuth: true, // allow without password
      password: ({username, password}) => {
        console.log('auth', {username, password})
        return username === 'test' && password === 'test'
      },
    })

    console.log(
      `%s %c%s %c%s %c->%c %s:%s`,
      ConnectionState[socks5.state],
      'color: green',
      conn.remoteAddr.hostname,
      'color: orange',
      socks5.addr.hostname,
      'color: inherit',
      'color: orange',
      socks5.distConn.remoteAddr.hostname,
      socks5.distConn.remoteAddr.port
    )

    const metric = await Promise.all([
      // client -> server
      copy(conn, socks5.distConn),
      // server -> client
      copy(socks5.distConn, conn),
    ])

    conn.close()
    socks5.distConn.close()

    metric // Statistic
      ? console.log('close conn', {RX: metric[1], TX: metric[0]})
      : console.log('close conn')
  } catch (e) {
    if (e instanceof Deno.errors.ConnectionReset) {
      console.error(e.name, e.message)
    } else if (e instanceof Error) {
      console.error(e.name, e.message)
      if (e.cause) console.error(e.cause)
    } else {
      console.error(e)
    }
  }
})
