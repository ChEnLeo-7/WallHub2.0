export const VIDEO_SEEK_SECONDS: number;
export function getVideoKeyboardAction(input?: {
  key?: string;
  targetTagName?: string;
  isContentEditable?: boolean;
}): { type: 'seek'; seconds: number } | { type: 'toggle-play' } | null;
export function getLongPressPlaybackRate(isHolding: boolean): 1 | 2;
export function getRestoredPlaybackRate(previousRate: number): number;
