import type { en } from './en';
import type { zh } from './zh';

export type Language = 'zh' | 'en';
export type AppText = typeof zh | typeof en;
