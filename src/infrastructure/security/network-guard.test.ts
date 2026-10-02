import { describe, expect, it } from 'vitest';
import { assertPublicHost, BlockedHostError, isPrivateAddress } from './network-guard';

describe('isPrivateAddress', () => {
  it.each([
    '10.0.0.5',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('bloquea %s', (address) => expect(isPrivateAddress(address)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111'])('permite %s', (address) =>
    expect(isPrivateAddress(address)).toBe(false),
  );
});

describe('assertPublicHost', () => {
  it('rechaza IP privadas salvo que se permitan (desarrollo con Mailpit)', async () => {
    await expect(assertPublicHost('169.254.169.254', false)).rejects.toBeInstanceOf(
      BlockedHostError,
    );
    await expect(assertPublicHost('127.0.0.1', true)).resolves.toBeUndefined();
    await expect(assertPublicHost('8.8.8.8', false)).resolves.toBeUndefined();
  });
});
