const decoder = new TextDecoder()

export const parseAuthPassword = (buf: Uint8Array) => {
  const username = new Uint8Array(buf.buffer, 2 /* VER + IDLEN */, buf.at(1) /* IDLEN */)
  const password = new Uint8Array(
    buf.buffer,
    username.byteLength + 2 /* VER + IDLEN */ + 1 /* PWLEN */,
    buf.at(username.byteLength + 2) /* PWLEN */
  )
  return {
    username: decoder.decode(username),
    password: decoder.decode(password),
  }
}

export const isLocalAddr = (conn: Deno.TcpConn) => {
  const localAddrs = ['192.168.', '127.0.0.1']
  return localAddrs.some((addr) => conn.remoteAddr.hostname.startsWith(addr))
}

export const getBndAddr = () => {
  const bndAddr = new Uint8Array(4)
  for (const {address} of Deno.networkInterfaces()) {
    if (address === '127.0.0.1') {
      bndAddr.set(address.split('.').map((octet) => parseInt(octet)))
      break
    }
  }

  return bndAddr
}
