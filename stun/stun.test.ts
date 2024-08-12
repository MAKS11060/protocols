#!/usr/bin/env -S deno run -A --unstable-hmr

import {STUN} from './stun.ts'

const stun = new STUN('stun://stun.l.google.com:19302')

console.log(await stun.getMappedAddress())
