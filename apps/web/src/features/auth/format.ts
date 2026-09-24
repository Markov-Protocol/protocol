/** A subject such as `did:privy:cm1abc…` or an email-like id, shortened for the top bar without hiding what it is. */
export function shortSubject(subject: string): string {
  if (subject.length <= 24) {
    return subject;
  }
  return `${subject.slice(0, 14)}…${subject.slice(-6)}`;
}

/** Human label for the identity issuer behind a session. */
export function issuerLabel(issuer: string): string {
  if (issuer.startsWith('urn:markov:test') || issuer.includes('test')) {
    return 'development issuer';
  }
  try {
    return new URL(issuer).host;
  } catch {
    return issuer;
  }
}
