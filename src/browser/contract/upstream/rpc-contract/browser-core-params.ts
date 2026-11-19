import { BrowserTarget, requiredString } from './rpc-param-primitives.js'

export const CertificateProceed = BrowserTarget.extend({
  challengeId: requiredString('Missing required challengeId')
})
