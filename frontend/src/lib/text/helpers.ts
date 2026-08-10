import * as React from 'react';

import { en } from './en';
import type { AppText, Language } from './types';
import { zh } from './zh';

export const LanguageContext = React.createContext<{ language: Language; text: AppText }>({
  language: 'zh',
  text: zh,
});

export function textFor(language: Language): AppText {
  return language === 'en' ? en : zh;
}

export function useText() {
  return React.useContext(LanguageContext).text;
}
