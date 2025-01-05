export const VER = 0x05
export const RSV = 0x00

export enum AUTH {
  NoAuth = 0x00,
  Password = 0x02,
}

export enum ADDR_TYPE {
  IPv4 = 0x01,
  IPv6 = 0x04,
  DomainName = 0x03,
}


export enum CLIENT_CMD {
  /** TCP connect  */
  Connect = 0x01,
  Bind = 0x02,
  UDPAssociate = 0x03,
}

export enum SERVER_REPLIES {
  Succeeded = 0x00,
  GeneralFailure = 0x01,
  ConnectionNotAllowedByRuleset = 0x02,
  NetworkUnreachable = 0x03,
  HostUnreachable = 0x04,
  ConnectionRefused = 0x05,
  TTLExpired = 0x06,
  CommandNotSupported = 0x07,
  AddressTypeNotSupport = 0x08,
}

// Internal state
export enum ConnectionState {
  ClientHello,
  ClientAuth,
  ClientRequest,
  Close,
  Open,
}
