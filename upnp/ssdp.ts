import {ints} from './os.ts'

const SSDP_ADDR = '239.255.255.250'
const SSDP_PORT = 1900
const SSDP_MX = 3
const SSDP_ST = 'ssdp:all'

export interface SSDPOptions {
  hostnames?: string[]
}

/** Simple Service Discovery Protocol */
export class SSDP {
  readonly conns: Deno.DatagramConn[]

  constructor(options?: SSDPOptions) {
    options ??= {}
    options.hostnames ??= ints.map((int) => int.address) // default local addr

    this.conns = options.hostnames.map((hostname) =>
      Deno.listenDatagram({transport: 'udp', hostname, port: 0})
    )

    if (!this.conns.length) {
      throw new Error('SSDP must have one or more hostnames')
    }
  }

  close() {
    for (const conn of this.conns) {
      conn.close()
    }
  }

  async search(searchTarget: string = SSDP_ST) {
    const message = [
      'M-SEARCH * HTTP/1.1',
      `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
      `MAN: "ssdp:discover"`,
      `MX: ${SSDP_MX}`,
      `ST: ${searchTarget}`,
      '',
      '',
    ].join('\r\n')

    // send message
    this.conns.map((conn) => {
      return conn.send(new TextEncoder().encode(message), {
        hostname: SSDP_ADDR,
        port: SSDP_PORT,
        transport: 'udp',
      })
    })

    // receive first
    const [buffer, addr, localAddr] = await Promise.race(
      this.conns.map((conn) =>
        conn
          .receive()
          .then((v) => [...v, conn.addr] as [Uint8Array, Deno.Addr, Deno.Addr])
      )
    )

    const response = new TextDecoder().decode(buffer)
    return {
      headers: this.#parseResponse(response),
      addr,
      localAddr,
    }
  }

  #parseResponse(response: string) {
    const headers: Record<string, string> = {}
    const lines = response.split('\r\n')
    const statusLine = lines.shift()
    const [version, statusCode, statusMessage] = statusLine?.split(' ')!
    headers['version'] = version
    headers['statusCode'] = statusCode
    headers['statusMessage'] = statusMessage

    for (const line of lines) {
      if (line === '') {
        break
      }
      const [name, value] = line.split(': ')
      headers[name.toLowerCase()] = value
    }
    return headers
  }
}
