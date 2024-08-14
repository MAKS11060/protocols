#!/usr/bin/env -S deno test -A --watch

import {assertEquals} from 'jsr:@std/assert'
import {handleWebSocket, WebSocketData} from './ws.ts'

// Deno.test('handleWebSocket handles fragmented data', async () => {})

Deno.test('handleWebSocket handles fragmented data', async () => {
  // return
  const server = Deno.listen({port: 8080})
  const client = await Deno.connect({port: 8080})

  // const serverPromise = new Promise<void>((resolve) => {
  //   server.accept().then(async (conn) => {
  //     const messages: WebSocketData[] = []
  //     await handleWebSocket(conn, (e) => {
  //       console.log(e)
  //       messages.push(e)
  //     })
  //     assertEquals(messages.length, 1)
  //     assertEquals(messages[0].type, 'string')
  //     assertEquals(messages[0].data, 'Hello, world!')
  //     resolve()
  //   })
  // })

  // const clientPromise = new Promise<void>((resolve) => {
  //   const data = new TextEncoder().encode('Hello, world!')
  //   const header = new Uint8Array([0x81, data.length])
  //   const packet1 = new Uint8Array([...header, ...data.subarray(0, 5)])
  //   const packet2 = new Uint8Array([0x00, data.length - 5, ...data.subarray(5)])
  //   client.write(packet1).then(() => {
  //     client.write(packet2).then(() => {
  //       client.close()
  //       resolve()
  //     })
  //   })
  // })

  const data = new Uint8Array(10)
  const serverPromise = new Promise<void>((resolve) => {
    server.accept().then(async (conn) => {
      const messages: WebSocketData[] = []
      await handleWebSocket(conn, (e) => {
        console.log(e)
        messages.push(e)
      })
      // assertEquals(messages.length, 1)
      assertEquals(messages[0].type, 'binary')
      assertEquals(messages[0].data, data)
      resolve()
    })
  })

  const clientPromise = new Promise<void>((resolve) => {
    const header = new Uint8Array([0b0000_0010, data.length])
    const packet1 = new Uint8Array([...header, ...data.subarray(0, 5)])
    const packet2 = new Uint8Array([0b1000_0010, data.length - 5, ...data.subarray(5)])
    client.write(packet1).then(() => {
      // setTimeout(() => {
        client.write(packet2).then(() => {
          client.close()
          resolve()
        })
      // }, 1000)
    })
  })

  await Promise.all([serverPromise, clientPromise])
  server.close()
})
