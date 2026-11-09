// The only module that imports `simplexrpl` (pre-1.0, pinned): everything else uses this interface.
import { RippleCustody } from 'simplexrpl'

export type CustodyConnection = {
  gatewayUrl: string
  tokenUrl: string
  clientId?: string
  domainId?: string
  primary: string
  signingKey: string
  allowRawSigning: boolean
}

export type Me = {
  publicKey: string
  domains: { id: string; alias: string; user: { id: string; alias: string; roles: string[] } }[]
}

export interface CustodyBackend {
  getMe(): Promise<Me>
}

export type Connect = (connection: CustodyConnection) => Promise<CustodyBackend>

export const connectRippleCustody: Connect = async connection => {
  const custody = await RippleCustody.create({
    gatewayUrl: connection.gatewayUrl,
    auth: { tokenUrl: connection.tokenUrl, clientId: connection.clientId, signingKey: connection.signingKey },
    domainId: connection.domainId,
    primary: connection.primary,
    allowRawSigning: connection.allowRawSigning,
  })
  return {
    getMe: async () => {
      const me = await custody.api.call('getMe')
      return {
        publicKey: me.publicKey,
        domains: me.domains.map(domain => ({
          id: domain.id,
          alias: domain.alias,
          user: { id: domain.userReference.id, alias: domain.userReference.alias, roles: domain.userReference.roles },
        })),
      }
    },
  }
}
