import type { Category, Member } from './constants';

export type Device = { id: string; name: string; room: string } & (
  { kind: 'light'; on: boolean; level: number } |
  { kind: 'ac'; on: boolean } |
  { kind: 'curtain'; position: 'open' | 'stop' | 'closed' } |
  { kind: 'robot'; cleaning: boolean; battery: number }
);
export type Rule = { id: string; name: string; trigger: string; condition: string; action: string; enabled: boolean; runs: number; lastRun: string | null };
export type State = {
  devices: Device[]; rules: Rule[]; greetings: Record<Member, string>; speaker: string; lightOn: boolean;
  events: { id: string; message: string; time: string }[];
  accounts: { id: string; name: string; category: Category; masked: string }[];
  expenses: { id: string; category: Category; cents: number; date: string; note: string }[];
};
export type Mutate = (path: string, method: string, body?: unknown) => Promise<boolean>;
export type Page = 'home' | 'automation' | 'billing' | 'vr' | 'profile';

export type User = { id: string; username: string; displayName: string; role: 'admin' | 'member' | 'guest'; createdAt: string; accessExpiresAt?: number };
export type Session = { household: { id: string; name: string } } & (
  { localPreview: true; user: Pick<User, 'id' | 'username' | 'displayName' | 'role'> } |
  { localPreview?: false; user: User; loggedInAt: string; expiresAt: number }
);
