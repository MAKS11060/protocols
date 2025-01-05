/**
 * @example
 * serveTcp({port: 80}, async (conn) => {
 *   console.log(conn.remoteAddr)
 *   conn.close()
 * })
 */
export const serveTcp = async (
  options: Deno.TcpListenOptions,
  handler: (conn: Deno.TcpConn) => Promise<void>
) => {
  const listener = Deno.listen(options)
  for await (const conn of listener) {
    try {
      handler(conn).catch((e) => {
        console.error(e)
      })
    } catch (e) {
      console.error(e)
    }
  }
}

/**
 * @example
 * const key = Deno.readTextFileSync(Deno.env.get('KEY')!)
 * const cert = Deno.readTextFileSync(Deno.env.get('CERT')!)
 * serveTlsTcp({key, cert, port: 443}, async (conn) => {
 *   console.log(conn.remoteAddr)
 *   conn.close()
 * })
 */
export const serveTlsTcp = async (
  options: Deno.ListenTlsOptions & Deno.TlsCertifiedKeyPem,
  handler: (conn: Deno.TlsConn) => Promise<void>
) => {
  const listener = Deno.listenTls(options)
  for await (const conn of listener) {
    try {
      handler(conn).catch((e) => {
        console.error(e)
      })
    } catch (e) {
      console.error(e)
    }
  }
}
