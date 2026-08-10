import { en } from './text/en';
import { zh } from './text/zh';

export const TEXT = {
  zh,
  en,
} as const;

export { LanguageContext, textFor, useText } from './text/helpers';
export type { AppText, Language } from './text/types';
