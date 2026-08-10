import * as React from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import {
  LanguageContext,
  TEXT,
  textFor,
  useText,
  type AppText,
  type Language,
} from '../text';
import { en } from './en';
import { zh } from './zh';

describe('text facade', () => {
  test('exposes both catalogs without changing their object identities', () => {
    expect(TEXT.zh).toBe(zh);
    expect(TEXT.en).toBe(en);
    expect(textFor('zh')).toBe(zh);
    expect(textFor('en')).toBe(en);
  });

  test('keeps catalog and nested genre keys aligned', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    expect(Object.keys(en.genres).sort()).toEqual(Object.keys(zh.genres).sort());
  });

  test('uses Chinese by default and reads a provided language context', () => {
    const defaultHook = renderHook(() => useText());
    expect(defaultHook.result.current).toBe(zh);

    const wrapper = ({ children }: React.PropsWithChildren) => (
      <LanguageContext.Provider value={{ language: 'en', text: en }}>
        {children}
      </LanguageContext.Provider>
    );
    const providedHook = renderHook(() => useText(), { wrapper });

    expect(providedHook.result.current).toBe(en);
  });

  test('preserves the public language and text types', () => {
    const language: Language = 'zh';
    const text: AppText = textFor(language);

    expect(text).toBe(zh);
  });
});
