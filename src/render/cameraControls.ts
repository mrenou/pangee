/**
 * Pan à la souris et zoom à la molette, branchés sur un élément DOM.
 *
 * Ne contient aucune logique de coordonnées : tout vient de src/model/viewport,
 * qui est partagé avec les outils d'édition. Voir docs/rendu.md.
 */

import { panByPixels, zoomAtPoint, type Viewport } from '@/model/viewport';

/** Sensibilité de la molette : un cran donne environ 10 % de zoom. */
const WHEEL_SENSITIVITY = 0.0015;

export interface CameraControls {
  destroy: () => void;
}

export function attachCameraControls(
  element: HTMLElement,
  getViewport: () => Viewport,
  onChange: (viewport: Viewport) => void,
  /** Le déplacement au glisser n'a lieu que si ceci renvoie vrai : un outil
   * actif doit pouvoir peindre sans déplacer la carte. Le zoom, lui, reste
   * toujours disponible. */
  canPan: () => boolean = () => true,
): CameraControls {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const localPoint = (event: PointerEvent | WheelEvent): { x: number; y: number } => {
    const rect = element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !canPan()) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    element.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    onChange(panByPixels(getViewport(), dx, dy));
  };

  const endDrag = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * WHEEL_SENSITIVITY);
    onChange(zoomAtPoint(getViewport(), factor, localPoint(event)));
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);
  element.addEventListener('wheel', onWheel, { passive: false });

  return {
    destroy: () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', endDrag);
      element.removeEventListener('pointercancel', endDrag);
      element.removeEventListener('wheel', onWheel);
    },
  };
}
