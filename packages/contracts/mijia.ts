export type MijiaRegion = 'cn' | 'de' | 'us' | 'ru' | 'sg' | 'tw' | 'i2';
export type MijiaRoom = { id: string; name: string; mappedRoomId?: string; mappedRoomName?: string; deviceCount?: number };
export type MijiaHome = { id: string; name: string; rooms: { id: string; name: string }[] };
export type MijiaChallenge = {
  id: string;
  expiresAt: string;
  type: 'captcha' | 'verification';
  image?: string;
  methods?: { id: 'phone' | 'email'; label: string }[];
  sent?: boolean;
  sentMethod?: 'phone' | 'email';
  captchaImage?: string;
};
export type MijiaStatus = {
  state: 'unbound' | 'authorizing' | 'choose_home' | 'connected' | 'offline' | 'reauth_required';
  region: MijiaRegion;
  challenge?: MijiaChallenge;
  homes: MijiaHome[];
  selectedHomeId?: string;
  rooms: MijiaRoom[];
  deviceCount: number;
  unsupportedCount: number;
  lastSyncAt?: string;
  pollIntervalSeconds: number;
  error?: string;
};
