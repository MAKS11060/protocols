export const isLocalAddr = ({address}: Deno.NetworkInterfaceInfo) => {
  return (
    address.startsWith('192.168.') ||
    address.startsWith('172.') ||
    address.startsWith('10.') ||
    address == '127.0.0.1'
  )
}

export const ints = Deno.networkInterfaces()
  .filter((i) => i.family === 'IPv4')
  .filter((i) => isLocalAddr(i))
