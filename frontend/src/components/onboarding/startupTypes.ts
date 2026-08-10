import type {
  StartupAccountCheck,
  StartupNetworkCheck,
  StartupNetworkProgress,
  StartupNetworkSettings,
  SteamStatus,
} from '@/lib/api';

export type StartupStep = 'account' | 'network' | 'ready';
export type SteamDecision = 'login' | 'skip' | null;
export type NetworkDecision = 'connected' | 'enhanced' | 'continue' | null;

export type StartupOnboardingState = {
  steamDecision: SteamDecision;
  networkDecision: NetworkDecision;
  steam: SteamStatus | null;
  account: StartupAccountCheck | null;
  network: StartupNetworkCheck | null;
  loginOpen: boolean;
  checkingAccount: boolean;
  checkingNetwork: boolean;
  networkProgress: StartupNetworkProgress | null;
  progressClock: number;
  completing: boolean;
  enhanceSetup: boolean;
  networkSettings: StartupNetworkSettings;
  networkSettingsReady: boolean;
  networkSettingsLoadError: string;
  customEndpoint: string;
  importingHosts: boolean;
  error: string;
};
