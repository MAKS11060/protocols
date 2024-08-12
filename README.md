# Implementation of simple protocols in typescript

## [STUN Client (RFC 5389)](https://datatracker.ietf.org/doc/html/rfc5389)

Usage:

```ts
#!/usr/bin/env -S deno run -A --unstable-net

import {STUN} from 'https://raw.githubusercontent.com/MAKS11060/deno-protocols/main/stun/stun.ts'

const stun = new STUN('stun.l.google.com:19302')

console.log(await stun.getMappedAddress()) // { hostname: "178.68.144.103", port: 49646, family: "IPv4" }
```
