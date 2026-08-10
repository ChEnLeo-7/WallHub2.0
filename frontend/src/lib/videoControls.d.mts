export const VIDEO_SEEK_SECONDS: number;
export const DEFAULT_VIDEO_PLAYER_MODE: 'native';
export const VIDEO_PLAYBACK_RATE_MIN: 0.5;
export const VIDEO_PLAYBACK_RATE_MAX: 3;
export function normalizeVideoPlayerMode(value: unknown): 'native' | 'compatibility';
export function formatVideoTime(value: number): string;
export function normalizeVideoPlaybackRate(value: unknown): number;
export function getVideoKeyboardAction(input?: {
  key?: string;
  targetTagName?: string;
  targetInputType?: string;
  isContentEditable?: boolean;
  isPlayerControl?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}): { type: 'seek'; seconds: number } | { type: 'toggle-play' } | { type: 'toggle-fullscreen' } | null;
export function getLongPressPlaybackRate(isHolding: boolean): 1 | 2;
export function getRestoredPlaybackRate(previousRate: number): number;
