export const ENABLE_AUTH = true
export const LOCAL_WITHOUT_AUTH = true // 127.0.0.1 192.168.100.*
export const RESTRICT_LOCAL = true // 127.0.0.1 192.168.100.*

export const passwd = new Map<string, string>()

if (!ENABLE_AUTH) passwd.set('', '')

passwd.set('4ae1d8bfa6bd45d8', 'b4d7-8d453c61c25b')
