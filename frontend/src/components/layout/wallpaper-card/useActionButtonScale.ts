import * as React from 'react';

import { HOME_VIEW_CARD_LAYOUT_TRANSITION } from '@/lib/motion';

type ActionButtonSize = {
  width: number;
  height: number;
};

const HOME_VIEW_BUTTON_LAYOUT_DURATION = HOME_VIEW_CARD_LAYOUT_TRANSITION.duration * 1000;
const [
  HOME_VIEW_BUTTON_FIRST_X_CONTROL_POINT,
  HOME_VIEW_BUTTON_FIRST_Y_CONTROL_POINT,
  HOME_VIEW_BUTTON_SECOND_X_CONTROL_POINT,
  HOME_VIEW_BUTTON_SECOND_Y_CONTROL_POINT,
] = HOME_VIEW_CARD_LAYOUT_TRANSITION.ease;

function cubicBezierCoordinate(timeParameter: number, firstControlPoint: number, secondControlPoint: number) {
  const inverseTimeParameter = 1 - timeParameter;
  return (
    3 * inverseTimeParameter * inverseTimeParameter * timeParameter * firstControlPoint
    + 3 * inverseTimeParameter * timeParameter * timeParameter * secondControlPoint
    + timeParameter * timeParameter * timeParameter
  );
}

function easeHomeViewLayout(progress: number) {
  if (progress <= 0 || progress >= 1) return progress;

  let lowerBound = 0;
  let upperBound = 1;
  let timeParameter = progress;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const xCoordinate = cubicBezierCoordinate(
      timeParameter,
      HOME_VIEW_BUTTON_FIRST_X_CONTROL_POINT,
      HOME_VIEW_BUTTON_SECOND_X_CONTROL_POINT,
    );
    if (xCoordinate < progress) lowerBound = timeParameter;
    else upperBound = timeParameter;
    timeParameter = (lowerBound + upperBound) / 2;
  }

  return cubicBezierCoordinate(
    timeParameter,
    HOME_VIEW_BUTTON_FIRST_Y_CONTROL_POINT,
    HOME_VIEW_BUTTON_SECOND_Y_CONTROL_POINT,
  );
}

function readActionButtonSize(button: HTMLButtonElement): ActionButtonSize {
  return { width: button.offsetWidth, height: button.offsetHeight };
}

export function useActionButtonScale(view: 'grid' | 'list', layoutAnimationEnabled: boolean) {
  const actionButtonRef = React.useRef<HTMLButtonElement>(null);
  const actionContentRef = React.useRef<HTMLSpanElement>(null);
  const animationFrameRef = React.useRef<number | null>(null);
  const animationIdentifierRef = React.useRef(0);
  const previousSizeRef = React.useRef<ActionButtonSize | null>(null);
  const previousViewRef = React.useRef(view);

  const clearTransforms = React.useCallback(() => {
    const actionButton = actionButtonRef.current;
    const actionContent = actionContentRef.current;
    if (actionButton) {
      actionButton.style.transform = '';
      actionButton.style.transformOrigin = '';
      actionButton.style.transition = '';
      actionButton.style.willChange = '';
    }
    if (actionContent) {
      actionContent.style.transform = '';
      actionContent.style.transformOrigin = '';
      actionContent.style.willChange = '';
    }
  }, []);

  const cancelAnimation = React.useCallback(() => {
    animationIdentifierRef.current += 1;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    clearTransforms();
  }, [clearTransforms]);

  React.useLayoutEffect(() => {
    const actionButton = actionButtonRef.current;
    if (!actionButton) return;

    const viewChanged = previousViewRef.current !== view;
    cancelAnimation();
    const nextSize = readActionButtonSize(actionButton);
    const previousSize = previousSizeRef.current;
    previousViewRef.current = view;
    previousSizeRef.current = nextSize;
    if (!layoutAnimationEnabled || !viewChanged || !previousSize) return;
    if (previousSize.width <= 0 || previousSize.height <= 0 || nextSize.width <= 0 || nextSize.height <= 0) return;

    const initialScaleX = previousSize.width / nextSize.width;
    const initialScaleY = previousSize.height / nextSize.height;
    if (Math.abs(initialScaleX - 1) <= 0.01 && Math.abs(initialScaleY - 1) <= 0.01) return;

    const actionContent = actionContentRef.current;
    const animationIdentifier = animationIdentifierRef.current + 1;
    const animationStartedAt = performance.now();
    animationIdentifierRef.current = animationIdentifier;
    actionButton.style.transformOrigin = 'top left';
    actionButton.style.transition = 'none';
    actionButton.style.willChange = 'transform';
    if (actionContent) {
      actionContent.style.transformOrigin = 'center';
      actionContent.style.willChange = 'transform';
    }

    const renderFrame = (frameTimestamp: number) => {
      if (animationIdentifierRef.current !== animationIdentifier) return;
      const progress = Math.min((frameTimestamp - animationStartedAt) / HOME_VIEW_BUTTON_LAYOUT_DURATION, 1);
      const remainingProgress = 1 - easeHomeViewLayout(progress);
      const currentScaleX = 1 + (initialScaleX - 1) * remainingProgress;
      const currentScaleY = 1 + (initialScaleY - 1) * remainingProgress;
      actionButton.style.transform = `scale(${currentScaleX}, ${currentScaleY})`;
      if (actionContent) {
        actionContent.style.transform = `scale(${1 / currentScaleX}, ${1 / currentScaleY})`;
      }
      if (progress >= 1) {
        animationFrameRef.current = null;
        clearTransforms();
        return;
      }
      animationFrameRef.current = requestAnimationFrame(renderFrame);
    };

    renderFrame(animationStartedAt);
    animationFrameRef.current = requestAnimationFrame(renderFrame);
  }, [cancelAnimation, clearTransforms, layoutAnimationEnabled, view]);

  React.useLayoutEffect(() => {
    const actionButton = actionButtonRef.current;
    if (!actionButton) return;
    const updateLayoutSnapshot = () => {
      if (animationFrameRef.current === null) previousSizeRef.current = readActionButtonSize(actionButton);
    };
    updateLayoutSnapshot();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateLayoutSnapshot);
      return () => window.removeEventListener('resize', updateLayoutSnapshot);
    }
    const observer = new ResizeObserver(updateLayoutSnapshot);
    observer.observe(actionButton);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => cancelAnimation, [cancelAnimation]);
  return { actionButtonRef, actionContentRef };
}
