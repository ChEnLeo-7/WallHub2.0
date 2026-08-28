import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { LanguageContext, textFor } from '@/lib/text';
import { ErrorState, isSteamAccountRecoveryBlockingWorkshop, LoadingState } from './AppPageStates';

describe('Steam account recovery loading state', () => {
  test.each([
    ['webapi', false],
    ['community', false],
    ['cm', true],
  ] as const)('reports pending account recovery for %s as blocking=%s', (dataSource, expected) => {
    expect(isSteamAccountRecoveryBlockingWorkshop(true, dataSource)).toBe(expected);
  });

  test('does not report account recovery without pending validation', () => {
    expect(isSteamAccountRecoveryBlockingWorkshop(false, 'cm')).toBe(false);
  });
});

describe('LoadingState', () => {
  test('prioritizes Steam account recovery over Workshop loading details', () => {
    render(
      <LanguageContext.Provider value={{ language: 'zh', text: textFor('zh') }}>
        <LoadingState warmingSteamIp restoringSteamAccount />
      </LanguageContext.Provider>,
    );

    expect(screen.getByText('正在恢复 Steam 账号...')).toBeInTheDocument();
    expect(screen.queryByText('正在抓取 Steam 创意工坊...')).not.toBeInTheDocument();
    expect(screen.queryByText('正在预热SteamIP……')).not.toBeInTheDocument();
  });

  test('keeps the regular Workshop loading message without account recovery', () => {
    render(
      <LanguageContext.Provider value={{ language: 'zh', text: textFor('zh') }}>
        <LoadingState />
      </LanguageContext.Provider>,
    );

    expect(screen.getByText('正在抓取 Steam 创意工坊...')).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  test('requests Steam login without showing network proxy actions for an expired session', () => {
    const onLoginRequired = vi.fn();
    render(
      <LanguageContext.Provider value={{ language: 'zh', text: textFor('zh') }}>
        <ErrorState
          message="Steam 登录已失效，请重新登录"
          onRetry={vi.fn()}
          proxyDomains={['steamcommunity.com']}
          requiresSteamLogin
          onLoginRequired={onLoginRequired}
        />
      </LanguageContext.Provider>,
    );

    expect(screen.getByText('本地固化的 Steam 登录会话已失效，需要重新登录并完成 Steam Guard 或手机确认。')).toBeInTheDocument();
    expect(screen.queryByText('复制代理域名')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新登录 Steam' }));
    expect(onLoginRequired).toHaveBeenCalledTimes(1);
  });
});
