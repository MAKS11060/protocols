import {IGD} from './igd.ts'
import {SSDP, type SSDPOptions} from './ssdp.ts'

type Protocol = 'TCP' | 'UDP'

interface GetGenericPortMappingEntryResponse {
  NewRemoteHost: string | null
  NewExternalPort: string
  NewProtocol: Protocol
  NewInternalPort: string
  NewInternalClient: string
  NewEnabled: string
  NewPortMappingDescription: string
  NewLeaseDuration: string
}

export interface MappingOptions {
  remoteHost?: string | null
  remotePort: number
  protocol?: Protocol
  localHost?: string
  localPort?: number
  enabled?: boolean
  description?: string
  ttl?: number
}

export type UnmapOptions = Pick<
  MappingOptions,
  'remoteHost' | 'remotePort' | 'protocol'
>

export interface UPnPOptions {
  ssdp?: SSDPOptions

  /** @default 'deno-upnp'' */
  name?: string
}

export class UPnP {
  ssdp: SSDP
  constructor(readonly options?: UPnPOptions) {
    this.options ??= {}
    this.options.name = 'deno-upnp'

    this.ssdp = new SSDP(options?.ssdp)
  }

  close() {
    this.ssdp.close()
  }

  async createGateway() {
    const {headers, addr, localAddr} = await this.ssdp.search(
      'urn:schemas-upnp-org:device:InternetGatewayDevice:1'
    )
    return {
      device: new IGD(headers.location),
      addr,
      localAddr,
    }
  }

  async getExternalIp(): Promise<string> {
    const gateway = await this.createGateway()
    const payload = await gateway.device.send('GetExternalIPAddress')

    for (const key in payload) {
      if (/:GetExternalIPAddressResponse/.test(key) && payload[key]) {
        const {NewExternalIPAddress} = payload[key] as Record<string, any>
        return NewExternalIPAddress as string
      }
    }

    throw new Error('Invalid Response')
  }

  async setMapping(options: MappingOptions) {
    const gateway = await this.createGateway()

    options.protocol ??= 'TCP'
    options.enabled ??= true
    options.description ??= this.options?.name
    options.localHost ??=
      (gateway.localAddr.transport === 'udp' && gateway.localAddr.hostname) ||
      ''

    await gateway.device.send('AddPortMapping', {
      NewRemoteHost: options?.remoteHost ?? '',
      NewExternalPort: String(options.remotePort),
      NewProtocol: options.protocol.toUpperCase(),
      NewInternalPort: String(options.localPort ?? options.remotePort),
      NewInternalClient: options.localHost,
      NewEnabled: Number(Boolean(options.enabled)),
      NewPortMappingDescription: options.description,
      NewLeaseDuration: String(options.ttl),
    })
  }

  async unmap(options: UnmapOptions) {
    options.protocol ??= 'TCP'

    const gateway = await this.createGateway()
    await gateway.device.send('DeletePortMapping', {
      NewRemoteHost: options?.remoteHost ?? '',
      NewExternalPort: String(options.remotePort),
      NewProtocol: options.protocol.toUpperCase(),
    })
  }

  async unmapAll(unmapAll: boolean = false) {
    for (const item of await this.getMapping()) {
      if (!unmapAll && item.description !== this.options?.name) continue
      await this.unmap(item)
    }
  }

  getMapping() {
    return Array.fromAsync(this.getMappingIter())
  }

  async *getMappingIter() {
    const gateway = await this.createGateway()

    let NewPortMappingIndex = 0
    while (true) {
      try {
        const payload = await gateway.device.send(
          'GetGenericPortMappingEntry',
          {NewPortMappingIndex: NewPortMappingIndex++}
        )

        for (const key in payload) {
          if (!/:GetGenericPortMappingEntryResponse/.test(key)) {
            throw new Error('Invalid Response')
          }
        }

        const data = payload[
          'u:GetGenericPortMappingEntryResponse'
        ] as GetGenericPortMappingEntryResponse

        yield {
          remoteHost: data.NewRemoteHost,
          remotePort: Number(data.NewExternalPort),
          protocol: data.NewProtocol,
          localHost: data.NewInternalClient,
          localPort: Number(data.NewInternalPort),
          ttl: Number(data.NewLeaseDuration),
          enabled: data.NewEnabled === '1',
          description: data.NewPortMappingDescription,
        } satisfies MappingOptions
      } catch (e) {
        return
      }
    }
  }
}
