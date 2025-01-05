import {invert} from 'jsr:@std/collections'


export enum CLIENT {
  VER = 0x05, // SOCKS5
}

// export enum CLIENT_REQUEST_ {
// }
export const CLIENT_REQUEST = {
  COMMAND: {
    IPv4: 1,
    DomainName: 3,
    IPv6: 4,
  }
}as const

console.log(invert(CLIENT_REQUEST.COMMAND))

export enum SERVER {
  VER = 0x05, // SOCKS5
}

export enum AUTH {
  NoAuthentication = 0x00,
  Password = 0x02,
  no_supported = 0xff,
}
