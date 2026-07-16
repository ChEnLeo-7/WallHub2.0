export type CommentTimeInput = { timestamp?: string | number; date?: string };

export function formatLocalizedDate(value: unknown, now?: Date): string;
export function shouldCompactDateOnlyText(value: unknown): boolean;
export function formatLocalizedDateTime(value: unknown, now?: Date): string;
export function formatLocalizedCommentTime(comment: CommentTimeInput, now?: Date): string;
