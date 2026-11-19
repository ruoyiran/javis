import type { PairedE2EEAuthCredential } from '../e2ee/paired-e2ee-client-handshake'
import type { PairingOffer } from './mobile-relay-pairing-offer'

// Connections carry credentials that may evolve beyond tokens; PairingOffer describes pairing input instead.
export type PairedRuntimeConnection = {
  javisEnvironmentId?: string
  javisHostTarget?: string
  javisCaller?: { connectionId: string; pairedDeviceId: string; clientKind: 'runtime' | 'mobile'; clientCapabilities?: string[] }
  endpoint: string
  ssh?: { alias: string; hostInstanceId?:string }
  hostPublicKeyB64?: string
  credential?: PairedE2EEAuthCredential
  pairedDeviceId?: string
}

type OfferConnectionFields = Pick<
  PairingOffer,
  'endpoint' | 'deviceToken' | 'publicKeyB64' | 'pairedDeviceId'
> &
  Partial<Pick<PairingOffer, 'v' | 'scope'>>

export function pairedRuntimeConnectionFromOffer(
  offer: OfferConnectionFields
): PairedRuntimeConnection {
  return {
    endpoint: offer.endpoint,
    hostPublicKeyB64: offer.publicKeyB64,
    credential: { kind: 'token', deviceToken: offer.deviceToken },
    ...(offer.pairedDeviceId ? { pairedDeviceId: offer.pairedDeviceId } : {})
  }
}

// The token request envelopes still carry on the wire.
export function pairedRuntimeConnectionToken(connection: PairedRuntimeConnection): string {
  if (!connection.credential) throw new Error('SSH connections authenticate through their SSH transport')
  return connection.credential.deviceToken
}

export function requireEncryptedRuntimeConnection(connection: PairedRuntimeConnection): PairedRuntimeConnection & { hostPublicKeyB64: string; credential: PairedE2EEAuthCredential } {
  if (connection.ssh || !connection.hostPublicKeyB64 || !connection.credential) throw new Error('SSH hosts require the authenticated Javis transport')
  return { ...connection, hostPublicKeyB64: connection.hostPublicKeyB64, credential: connection.credential }
}
