export const panelMotion = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
};

export const panelLayoutMotion = {
  ...panelMotion,
  transition: {
    ...panelMotion.transition,
    layout: { type: 'spring' as const, stiffness: 330, damping: 34, mass: 0.9 },
  },
};
