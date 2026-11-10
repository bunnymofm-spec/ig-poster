// AES-256-GCM for the schedule and the state, so the public repo shows nothing readable.
import crypto from 'node:crypto';
export function seal(obj, hexKey) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv);
  const body = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}
export function open(b64, hexKey) {
  const b = Buffer.from(b64.trim(), 'base64'), d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString());
}
