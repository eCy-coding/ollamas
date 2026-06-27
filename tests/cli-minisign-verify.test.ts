import { describe, it, expect } from 'vitest';
import { parseMinisignPubkey, parseMinisig, verifyMinisign } from '../cli/lib/minisign-verify.js';

// Real fixture — public, safe to commit.
const PUBKEY_TEXT = [
  'untrusted comment: minisign public key',
  'RWTF38Nw+5ywgfWk4v21whWSxR4mXPnVNMgaPJGymkzzIhz2hfkIhI6q',
].join('\n');

const FILE_BYTES = Buffer.from('ollamas v18 test artifact\n');

const MINISIG_TEXT = [
  'untrusted comment: signature from minisign secret key',
  'RUTF38Nw+5ywgVnh1f4LmtbSQ16v1/fphdvM1llZhU643rJZmkqATVupxY+8o1NGqfNRXXpbYSqlSAGc/Us6mhoAhH1HUU8xNww=',
  'trusted comment: timestamp:1782598302\tfile:artifact.bin\thashed',
  'qpkXsN52Tb2bXGIkoG5JyxLeyVVrI86f9+LhXAUkZODyHr9Y1FblwCUrico8/Ber7uMlVrlm9UkHFHVqN2LVDw==',
].join('\n');

describe('minisign-verify', () => {
  it('parses pubkey without throwing', () => {
    const pk = parseMinisignPubkey(PUBKEY_TEXT);
    expect(pk.keyId).toHaveLength(8);
    expect(pk.pub).toHaveLength(32);
  });

  it('parses .minisig without throwing', () => {
    const ms = parseMinisig(MINISIG_TEXT);
    expect(ms.algo).toBe('ED');
    expect(ms.keyId).toHaveLength(8);
    expect(ms.sig).toHaveLength(64);
    expect(ms.globalSig).toHaveLength(64);
    expect(ms.trustedComment).toContain('timestamp:');
  });

  it('(1) valid fixture → ok:true', () => {
    const result = verifyMinisign(FILE_BYTES, MINISIG_TEXT, PUBKEY_TEXT);
    expect(result.ok).toBe(true);
  });

  it('(2) tampered file → ok:false', () => {
    const bad = Buffer.from('ollamas v18 test artifact!\n'); // changed 'artifact\n' → 'artifact!\n'
    const result = verifyMinisign(bad, MINISIG_TEXT, PUBKEY_TEXT);
    expect(result.ok).toBe(false);
  });

  it('(3) wrong pubkey → ok:false', () => {
    // flip one char in line 2 to get different key bytes
    const badPubkey = PUBKEY_TEXT.replace('RWTF38Nw+5ywgfWk4v21wh', 'RWTF38Nw+5ywgfWk4v21wx');
    const result = verifyMinisign(FILE_BYTES, MINISIG_TEXT, badPubkey);
    expect(result.ok).toBe(false);
  });

  it('(4) tampered trusted-comment → ok:false (global-sig guard)', () => {
    const tampered = MINISIG_TEXT.replace(
      'trusted comment: timestamp:1782598302\tfile:artifact.bin\thashed',
      'trusted comment: timestamp:1782598302\tfile:evil.bin\thashed',
    );
    const result = verifyMinisign(FILE_BYTES, tampered, PUBKEY_TEXT);
    expect(result.ok).toBe(false);
  });

  it('(5) malformed .minisig → ok:false with reason (no throw)', () => {
    const result = verifyMinisign(FILE_BYTES, 'not a valid minisig', PUBKEY_TEXT);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});
