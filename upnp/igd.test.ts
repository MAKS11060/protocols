#!/usr/bin/env -S deno run -A --unstable-hmr

import {IGD} from './igd.ts'
import {SSDP} from './ssdp.ts'

const ssdp = new SSDP()
const {headers} = await ssdp.search(
  'urn:schemas-upnp-org:device:InternetGatewayDevice:1'
)
// console.log(headers)

const igd = new IGD(headers.location)

console.log(await igd.getDevice())
console.log(await igd.getService())
