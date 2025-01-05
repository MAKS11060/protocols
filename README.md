# Pure implementation of network protocols using Deno + Typescript

- [Implementation of simple protocols in typescript](#implementation-of-simple-protocols-in-typescript)
  - [SOCKS5 Server (RFC 1928)](#socks5-server-rfc-1928)
  - [WebSocket Stream Server (RFC 6455)](#websocket-stream-server-rfc-6455)
  - [UPnP Client (RFC 6970)](#upnp-client-rfc-6970)
    - [Methods](#methods)
  - [STUN Client (RFC 5389)](#stun-client-rfc-5389)

## [SOCKS5 Server (RFC 1928)](https://datatracker.ietf.org/doc/html/rfc1928)

- [Code Example](socks/test.ts)

```ts
// socks/test.ts
serveTcp({port: 40443}, async (conn) => {
  try {
    const socks5 = await upgradeSocks5(conn, bndAddrFromNetAddr(conn.localAddr))
    if (!socks5) throw new Error('SOCKS5 upgrade failed')

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
    if (e instanceof Error) {
      console.error(e.message)
    } else {
      console.error(e)
    }
  }
})
```

## [WebSocket Stream Server (RFC 6455)](https://datatracker.ietf.org/doc/html/rfc6455)

Implementing Websocket as a [WebSocketStream](https://github.com/ricea/websocketstream-explainer) server using [StreamApi](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API)

Usage:

```ts
#!/usr/bin/env -S deno run -A --watch-hmr

import {serveTcp} from 'https://raw.githubusercontent.com/MAKS11060/deno-protocols/main/utils.ts'
import {upgradeWebSocketStream} from 'https://raw.githubusercontent.com/MAKS11060/deno-protocols/main/websocket/ws.ts'

serveTcp({port: 8000}, async (conn) => {
  console.log(conn.remoteAddr.hostname)

  const {url, headers, readable, writable} = await upgradeWebSocketStream(conn)
  console.log(url, headers)

  const writer = writable.getWriter()
  for await (const msg of readable.values()) {
    console.log({msg})
    writer.write(msg) // loopback
  }

  console.log('[WebSocketStream] Close')
})
```

## [UPnP Client (RFC 6970)](https://datatracker.ietf.org/doc/html/rfc6970)

The UPnP Client provides a simple interface for managing network port mappings.

### Methods
- `getExternalIp()`: Returns the public IP address.
- `setMapping(options)`: Opens a port with the specified options.
- `getMapping()`: Returns a list of all current port mappings.
- `unmap(options)`: Removes a port mapping with the specified options.
- `unmapAll()`: Removes all port mappings.

Usage:

```ts
#!/usr/bin/env -S deno run -A --unstable-net

import {UPnP} from 'https://raw.githubusercontent.com/MAKS11060/deno-protocols/main/upnp/upnp.ts'

const upnp = new UPnP()

// Get public address
console.log('my ip', await upnp.getExternalIp())

// Open port
await upnp.setMapping({remotePort: 8000, ttl: 150})
console.log('upnp list', await upnp.getMapping())

// Remove port
// await this.unmap({remotePort: 8000})

// Remove all ports
// await this.unmapAll()
```

## [STUN Client (RFC 5389)](https://datatracker.ietf.org/doc/html/rfc5389)

Usage:

```ts
#!/usr/bin/env -S deno run -A --unstable-net

import {STUN} from 'https://raw.githubusercontent.com/MAKS11060/deno-protocols/main/stun/stun.ts'

const stun = new STUN('stun.l.google.com:19302')

console.log(await stun.getMappedAddress()) // { hostname: "178.68.144.103", port: 49646, family: "IPv4" }
```
