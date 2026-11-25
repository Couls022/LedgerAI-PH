// The LedgerAI Client ONLY contains Public Key Verification logic.
// Private keys and signing operations are strictly prohibited in src/.
export {
  RSA_PUBLIC_KEY,
  DEV_TEST_AUTHORITY_KEY_ID,
  AuthorityCrypto,
  verifyLicense,
  parseAndVerifyToken,
  extractAndValidateLicense,
  getAuthorityPublicKeyRing,
  registerAuthorityPublicKey,
  revokeAuthorityKeyId,
  resetAuthorityKeyRingForTesting,
} from './verify';
