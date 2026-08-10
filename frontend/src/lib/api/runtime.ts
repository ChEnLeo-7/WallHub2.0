import { parseJson } from './request';
import type { UpdateStatus } from './updates';

export type RuntimeStatus = {
  revision?: string;
  version?: string;
  platform: string;
  arch: string;
  docker?: boolean;
  termux: boolean;
  canRestart?: boolean;
  canShutdown?: boolean;
  supervised?: boolean;
  downloaderMode: string;
  effectiveDownloader: string;
  nsfwEnabled: boolean;
  runnerDir: string;
  downloadsDir: string;
  runtimeSetup?: {
    status?: string;
    progress?: number;
    message?: string;
    runnerDir?: string;
    downloadsDir?: string;
    requestedMode?: string;
    mode?: string;
  };
  update?: UpdateStatus;
  steamCdn?: {
    currentHost?: string;
    currentVHost?: string;
    currentPort?: number;
    source?: string;
    mode?: string;
    strategy?: string;
    updatedAt?: number;
    recent?: Array<{
      host?: string;
      vhost?: string;
      port?: number;
      source?: string;
      mode?: string;
      strategy?: string;
      at?: number;
    }>;
  };
  steamAccess?: {
    enabled?: boolean;
    mode?: 'resolver' | 'hosts';
    resolverProtocol?: 'doh' | 'dot' | 'mixed' | 'hosts' | 'literal';
    resolverEndpoint?: string;
    resolverEndpoints?: string[];
    resolverHealth?: Array<{
      endpoint?: string;
      protocol?: 'doh' | 'dot';
      ok?: boolean;
      failures?: number;
      avgMs?: number;
      cooldownUntil?: number;
    }>;
    metrics?: Record<string, unknown>;
    connectionPool?: Record<string, unknown>;
    policy?: Record<string, unknown> | null;
    hosts?: {
      entries?: number;
      lastUpdatedAt?: number;
      lastError?: string;
      nextUpdateAt?: number;
    };
    dohEndpoint?: string;
    dohEndpoints?: string[];
    dotEndpoint?: string;
    dotEndpoints?: string[];
    webapiPool?: {
      host?: string;
      active?: number;
      cooling?: number;
      fastest?: string;
      rttMs?: number;
      lastRefreshAt?: number;
      nextRefreshAt?: number;
      lastError?: string;
      akamaiCidrMatched?: number;
      suspectDnsAnswers?: number;
      cdnDatabaseUpdatedAt?: number;
      cdnDatabaseSource?: string;
      direct?: boolean;
      connections?: Array<{
        host?: string;
        ip?: string;
        protocol?: string;
        sniMode?: string;
        state?: string;
        createdAt?: number;
        lastUsedAt?: number;
        requestCount?: number;
        reusedCount?: number;
        lastLocalPort?: number;
        connectionAgeMs?: number;
        lastError?: string;
        lastResetAt?: number;
        cooldownUntil?: number;
      }>;
      ech?: {
        host?: string;
        echSupported?: boolean;
        checkedAt?: number;
        error?: string;
      };
    };
    current?: {
      hostname?: string;
      port?: number;
      ip?: string;
      ips?: string[];
      source?: string;
      resolverProtocol?: 'doh' | 'dot' | 'mixed' | 'hosts' | 'literal';
      resolverEndpoint?: string;
      resolverEndpoints?: string[];
      dohEndpoint?: string;
      dohEndpoints?: string[];
      candidates?: number;
      reachable?: number;
      updatedAt?: number;
      sniMode?: string;
      sniHostname?: string;
      sniStrategies?: Array<Record<string, unknown>>;
      policy?: Record<string, unknown>;
    } | null;
    routes?: Array<{
      hostname?: string;
      port?: number;
      ip?: string;
      ips?: string[];
      source?: string;
      resolverProtocol?: 'doh' | 'dot' | 'mixed' | 'hosts' | 'literal';
      resolverEndpoint?: string;
      resolverEndpoints?: string[];
      dohEndpoint?: string;
      dohEndpoints?: string[];
      candidates?: number;
      reachable?: number;
      updatedAt?: number;
      sniMode?: string;
      sniHostname?: string;
      sniStrategies?: Array<Record<string, unknown>>;
      policy?: Record<string, unknown>;
    }>;
  };
};

export type RuntimeDiagnostics = {
  revision?: string;
  generatedAt?: number;
  runtimeSetup?: RuntimeStatus['runtimeSetup'];
  steamCdn?: RuntimeStatus['steamCdn'];
  steamAccess?: RuntimeStatus['steamAccess'];
  depotStream?: Record<string, unknown>;
};

export async function getRuntime() {
  const res = await fetch('/api/server/runtime');
  return parseJson<RuntimeStatus>(res);
}

export async function getRuntimeDiagnostics() {
  const res = await fetch('/api/server/runtime/diagnostics', { cache: 'no-store' });
  return parseJson<RuntimeDiagnostics>(res);
}

export async function restartServer() {
  const res = await fetch('/api/server/restart', { method: 'POST' });
  return parseJson<{ success: boolean; message?: string; logPath?: string }>(res);
}

export async function shutdownServer() {
  const res = await fetch('/api/server/shutdown', { method: 'POST' });
  return parseJson<{ success: boolean; message?: string }>(res);
}
