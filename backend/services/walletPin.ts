import bcrypt from 'bcrypt';

export const DEFAULT_WALLET_PIN = '1234';

export function validateWalletPin(raw: string): string | null {
  const pin = raw.trim();
  if (!/^\d{4}$/.test(pin)) return null;
  return pin;
}

export async function hashWalletPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export async function defaultWalletPinData() {
  return {
    walletPinHash: await hashWalletPin(DEFAULT_WALLET_PIN),
    walletPinSetAt: new Date(),
  };
}

export async function buildWalletPinUpdate(opts: { pin?: string; resetPin?: boolean }): Promise<{
  walletPinHash?: string;
  walletPinSetAt?: Date;
}> {
  if (opts.resetPin === true) {
    return defaultWalletPinData();
  }

  if (typeof opts.pin === 'string' && opts.pin.trim()) {
    const raw = validateWalletPin(opts.pin);
    if (!raw) throw new Error('INVALID_PIN');
    return {
      walletPinHash: await hashWalletPin(raw),
      walletPinSetAt: new Date(),
    };
  }

  return {};
}
