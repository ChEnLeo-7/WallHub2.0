export const DEFAULT_DETAILS_PRESENTATION: 'redesigned';

export const REDESIGNED_DETAILS_PANEL_STYLE: {
  readonly rightColumn: { readonly minHeight: 0; readonly height: '100%' };
  readonly description: { readonly minHeight: 0; readonly height: '100%'; readonly overflowY: 'auto' };
};

export function normalizeDetailsPresentation(value: unknown): 'classic' | 'redesigned';
