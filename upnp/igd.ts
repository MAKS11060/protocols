/**
 * IGD (Internet Gateway Device)
 *
 * @module
 */

import {parse, stringify, xml_node} from '@libs/xml'

type Device = {
  deviceType: string
  friendlyName?: string
  deviceList: DeviceList
  serviceList: ServiceList
}
type DeviceList = {
  device: Device
}
// add: SCPDURL field
type Service = {
  serviceType: string
  controlURL: string
}
type ServiceList = {
  service: Service
}

type DeviceResult =
  | ({kind: 'device'} & Pick<Device, 'deviceType' | 'friendlyName'>)
  | ({kind: 'service'} & Service)

/** Internet Gateway Device */
export class IGD {
  readonly services = [
    'urn:schemas-upnp-org:service:WANIPConnection:1',
    'urn:schemas-upnp-org:service:WANIPConnection:2',
    'urn:schemas-upnp-org:service:WANPPPConnection:1',
  ]

  constructor(readonly uri: string) {}

  async getDevice() {
    const res = await fetch(this.uri)
    const text = await res.text()
    const xml = parse(text)
    const root = xml['root'] as Record<string, any> & {device: Device}

    return this.parseDevice(root.device)
  }

  async getService() {
    // find service
    const service = (await this.getDevice())
      .filter((d) => d.kind === 'service')
      .find((d) => this.services.includes(d.serviceType))

    if (!service) {
      throw new Error('WANIPConnection service not found')
    }

    if (!service.controlURL) {
      throw new Error('Service controlURL not found')
    }

    return service
  }

  async send(action: string, args?: Record<string, unknown>) {
    const service = await this.getService()

    const url = new URL(service.controlURL, this.uri)
    const body = stringify({
      '@version': '1.0',
      '@encoding': 'utf-8',
      's:Envelope': {
        '@xmlns:s': 'http://schemas.xmlsoap.org/soap/envelope/',
        '@s:encodingStyle': 'http://schemas.xmlsoap.org/soap/encoding/',
        's:Body': {
          [`u:${action}`]: {
            // '@xmlns:u': 'urn:schemas-upnp-org:service:WANIPConnection:1',
            '@xmlns:u': service.serviceType,
            ...args,
          },
        },
      },
    })

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': `text/xml; charset="utf-8"`,
        SOAPAction: JSON.stringify(`${service.serviceType}#${action}`),
      },
      body,
    })
    const text = await res.text()
    const xml = parse(text)

    if (res.status !== 200) {
      const data = xml['s:Envelope'] as xml_node
      const body = data['s:Body'] as xml_node
      const {faultstring, detail} = body['s:Fault'] as any
      const {errorCode, errorDescription} = detail[faultstring] as xml_node
      throw new Error(`${errorDescription}`, {
        cause: `${faultstring} - ${errorCode}`,
      })
    }

    const data = xml['s:Envelope'] as xml_node
    return {
      ...(data['s:Body'] as xml_node),
    } as Record<string, unknown>
  }

  parseDevice(device: Device): DeviceResult[] {
    return Array.from(this.#parseDevice(device) as DeviceResult[])
  }

  *#parseDevice(device: Device): any {
    if (device) {
      yield {
        kind: 'device',
        deviceType: device.deviceType,
        friendlyName: device.friendlyName,
      }
    }

    if (device.serviceList) {
      yield {
        kind: 'service',
        serviceType: device.serviceList.service.serviceType,
        controlURL: device.serviceList.service.controlURL,
      }
    }

    if (device.deviceList) {
      yield* this.#parseDevice(device.deviceList.device)
    }
  }
}
