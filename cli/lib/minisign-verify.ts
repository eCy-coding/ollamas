import { createHash, verify as cryptoVerify } from 'node:crypto';

export interface MinisignPubkey {
  keyId: Buffer;
  pub: Buffer;
}

export interface Minisig {
  algo: string;
  keyId: Buffer;
  sig: Buffer;
  trustedComment: string;
  globalSig: Buffer;
}

/**
 * Parse a minisign public-key file (two-line format).
 * Line 2 = base64 of [2B algo | 8B keyId | 32B Ed25519 pubkey].
 */
export function parseMinisignPubkey(text: string): MinisignPubkey {
  const lines = text.trim().split('\n');
  // line index 1 is the base64 payload (line 0 is untrusted comment)
  const raw = Buffer.from(lines[1].trim(), 'base64');
  // raw[0..1] = algo tag, raw[2..9] = keyId, raw[10..41] = 32B pubkey
  return {
    keyId: raw.subarray(2, 10),
    pub: raw.subarray(10, 42),
  };
}

/**
 * Parse a .minisig file (4-line format).
 * Line 2 = base64 of [2B algo | 8B keyId | 64B sig].
 * Line 3 = "trusted comment: <text>".
 * Line 4 = base64 global sig (64B) over (sig64 || trustedCommentText).
 */
export function parseMinisig(text: string): Minisig {
  const lines = text.trim().split('\n');
  const raw = Buffer.from(lines[1].trim(), 'base64');
  const algoBytes = raw.subarray(0, 2);
  const algo = algoBytes.toString('ascii'); // "Ed" legacy or "ED" hashed
  const keyId = raw.subarray(2, 10);
  const sig = raw.subarray(10, 74);

  // line 3: "trusted comment: ..."
  const tcLine = lines[2];
  const tcPrefix = 'trusted comment: ';
  const trustedComment = tcLine.startsWith(tcPrefix) ? tcLine.slice(tcPrefix.length) : tcLine;

  const globalSig = Buffer.from(lines[3].trim(), 'base64');

  return { algo, keyId, sig, trustedComment, globalSig };
}

// SPKI header for Ed25519 (RFC 8410)
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function wrapSpki(rawPub32: Buffer): Buffer {
  return Buffer.concat([ED25519_SPKI_PREFIX, rawPub32]);
}

/**
 * Verify a minisign signature.
 * Pure: takes bytes/strings only — no disk/socket access.
 * Returns {ok:false, reason} on any failure instead of throwing.
 */
export function verifyMinisign(
  fileBytes: Buffer,
  minisigText: string,
  pubkeyText: string,
): { ok: boolean; reason?: string } {
  try {
    const pk = parseMinisignPubkey(pubkeyText);
    const ms = parseMinisig(minisigText);

    // Key-id must match
    if (!pk.keyId.equals(ms.keyId)) {
      return { ok: false, reason: 'keyId mismatch' };
    }

    const spki = wrapSpki(pk.pub);
    const keyObj = { key: spki, format: 'der' as const, type: 'spki' as const };

    // Compute digest: "ED" = blake2b512(file), "Ed" (legacy) = raw file
    let digest: Buffer;
    if (ms.algo === 'ED') {
      digest = createHash('blake2b512').update(fileBytes).digest() as unknown as Buffer;
    } else if (ms.algo === 'Ed') {
      digest = fileBytes;
    } else {
      return { ok: false, reason: `unknown algo: ${ms.algo}` };
    }

    // Verify file signature
    const fileSigOk = cryptoVerify(null, digest, keyObj, ms.sig);
    if (!fileSigOk) {
      return { ok: false, reason: 'file signature invalid' };
    }

    // Verify global sig over (sig64 || trustedCommentText)
    // trustedCommentText is the raw text after "trusted comment: "
    const globalData = Buffer.concat([ms.sig, Buffer.from(ms.trustedComment)]);
    const globalSigOk = cryptoVerify(null, globalData, keyObj, ms.globalSig);
    if (!globalSigOk) {
      return { ok: false, reason: 'global signature invalid (trusted comment tampered?)' };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
