#!/usr/bin/env -S deno run -A --unstable-hmr

import {SSDP} from "./ssdp.ts"

const ssdp = new SSDP()

console.log(await ssdp.search())
// console.log(await ssdp.search('urn:schemas-upnp-org:device:InternetGatewayDevice:1'))