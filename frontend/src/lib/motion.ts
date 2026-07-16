export const BACK_TO_TOP_MOTION = {
  initial: { opacity: 0, y: 14, scale: 0.88, filter: 'blur(2px)' },
  animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, y: 10, scale: 0.9, filter: 'blur(1px)' },
  transition: { duration: 0.26, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
};

export const HOME_VIEW_CARD_LAYOUT_TRANSITION = {
  type: 'tween' as const,
  duration: 0.4,
  ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
};

export const HOME_VIEW_MEDIA_LAYOUT_TRANSITION = {
  type: 'tween' as const,
  duration: 0.52,
  ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
};

export const DETAILS_READY_CONTENT_MOTION = {
  initial: { opacity: 0.04, y: 16, scale: 0.985, filter: 'blur(3px)' },
  animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
  transition: { duration: 0.52, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
};
