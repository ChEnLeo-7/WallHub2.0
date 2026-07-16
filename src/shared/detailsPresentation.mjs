export const DEFAULT_DETAILS_PRESENTATION = 'redesigned';

export const REDESIGNED_DETAILS_PANEL_STYLE = Object.freeze({
  rightColumn: Object.freeze({
    minHeight: 0,
  }),
  description: Object.freeze({
    minHeight: 0,
    overflowY: 'auto',
  }),
});

export function normalizeDetailsPresentation(value) {
  return value === 'classic' ? 'classic' : DEFAULT_DETAILS_PRESENTATION;
}
