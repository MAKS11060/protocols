#!/usr/bin/env -S deno run -A --unstable-hmr

import {UPnP} from './upnp.ts'

const upnp = new UPnP()

console.log('my ip', await upnp.getExternalIp())

await upnp.setMapping({remotePort: 8000, ttl: 150})
await upnp.setMapping({remotePort: 8001, ttl: 200, protocol: 'UDP'})
console.log('upnp list', await upnp.getMapping())

await upnp.unmapAll()
console.log('unmapAll')

for await (const data of upnp.getMappingIter()) {
  console.log(data)
}
