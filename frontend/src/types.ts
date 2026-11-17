import type {AutomationRule,AutomationRun} from '../../packages/contracts/automations';
import type {Scene, SceneRun} from '../../packages/contracts/scenes';
export type {Scene, SceneRun} from '../../packages/contracts/scenes';
import type { Category, Member } from './constants';

import type { DeviceSnapshot } from '../../packages/contracts/devices';
export type { Device, Capability, DeviceState, DeviceCommand, DeviceSnapshot } from '../../packages/contracts/devices';
export type Rule = { id: string; name: string; trigger: string; condition: string; action: string; enabled: boolean; runs: number; lastRun: string | null };
export type State = {
  automations: AutomationRule[]; automationRuns: AutomationRun[]; scenes: Scene[]; sceneRuns: SceneRun[]; devices: DeviceSnapshot[]; rules: Rule[]; greetings: Record<Member, string>; speaker: string; lightOn: boolean;
  events: { id: string; message: string; time: string }[];
  accounts: { id: string; name: string; category: Category; masked: string }[];
  expenses: { id: string; category: Category; cents: number; date: string; note: string }[];
};
export type Mutate = (path: string, method: string, body?: unknown) => Promise<boolean>;
export type Page = 'home' | 'devices' | 'rooms' | 'account' | 'scenes' | 'automation' | 'billing' | 'vr' | 'profile';

export type User = { id: string; username: string; displayName: string; role: 'admin' | 'member' | 'guest'; createdAt: string; accessExpiresAt?: number };
export type Session = { household: { id: string; name: string } } & (
  { localPreview: true; user: Pick<User, 'id' | 'username' | 'displayName' | 'role'> } |
  { localPreview?: false; user: User; loggedInAt: string; expiresAt: number }
);
