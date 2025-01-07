#!/usr/bin/env -S deno test -A --watch

import {expect} from 'jsr:@std/expect'
import {ADDR_TYPE, RSV, VER} from './enum.ts'
import {ipv6ToUint8Array, parseSocks5Addr} from './utils.ts'

Deno.test('ParseSocks5Addr IPv4', () => {
  const addrType1 = new Uint8Array([
    ...[VER, 0x01, RSV, ADDR_TYPE.IPv4], // VER CMD RSV ADDR_TYPE
    ...[0x7f, 0x00, 0x00, 0x01], // Dist addr
    ...[0x03, 0x55], //            Dist port
  ])
  const addr = parseSocks5Addr(addrType1)
  expect(addr.hostname).toBe('127.0.0.1')
  expect(addr.port).toBe(853)
  expect(addr.type).toBe(ADDR_TYPE.IPv4)
})

Deno.test('ParseSocks5Addr IPv6', () => {
  // const IPv6 = '2001:0000:130F:0000:0000:09C0:876A:130B'
  const IPv6 = '0000:0000:0000:0000:0000:0000:0000:0001'
  const u8ip = ipv6ToUint8Array(IPv6)
  const addrType4 = new Uint8Array([
    ...[VER, 0x01, RSV, ADDR_TYPE.IPv6], // VER CMD RSV ADDR_TYPE
    ...u8ip, //                     Dist addr
    ...[0x03, 0x55], //             Dist port
  ])

  const addr = parseSocks5Addr(addrType4)
  expect(addr.hostname).toBe(IPv6)
  expect(addr.port).toBe(853)
  expect(addr.type).toBe(ADDR_TYPE.IPv6)
})

Deno.test('ParseSocks5Addr Domain name', () => {
  //       22 00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15
  // 00000000 05 01 00 03 0f 6f 6e 65 2e 6f 6e 65 2e 6f 6e 65
  // 00000010 2e 6f 6e 65 03 55

  const hostname = new TextEncoder().encode('one.one.one.one')
  const addrType3 = new Uint8Array([
    ...[VER, 0x01, RSV, ADDR_TYPE.DomainName], // VER CMD RSV ADDR_TYPE
    hostname.byteLength, // Len
    ...hostname, //         Hostname
    ...[0x03, 0x55], //     Dist port
  ])

  const addr = parseSocks5Addr(addrType3)
  expect(addr.hostname).toBe('one.one.one.one')
  expect(addr.port).toBe(853)
  expect(addr.type).toBe(ADDR_TYPE.DomainName)
})
