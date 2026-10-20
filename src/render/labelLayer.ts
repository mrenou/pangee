/**
 * Lieux et libellés.
 *
 * Tout est positionné en pixels écran, et non dans un conteneur mis à
 * l'échelle : une icône et un nom doivent garder leur taille quel que soit le
 * zoom. Les lieux sont stockés en référentiel local, donc convertis ici à la
 * date courante — c'est ce qui fait qu'une ville suit son anneau.
 * Voir docs/rendu.md et docs/modele-monde.md.
 */

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { RingConfig } from '@/model/ring';
import { localToWorldLon } from '@/model/time';
import { worldToScreen, type Viewport } from '@/model/viewport';
import type { Place, PlaceKind, PlaceSize } from '@/model/world';
import { findLabelSpot, iconRect, labelRect, overlaps, type Rect } from '@/render/labelPlacement';
import { drawPlaceIcon } from '@/render/placeIcons';

/** Rayon de l'icône, en pixels, selon l'importance du lieu. */
const ICON_RADIUS_PX: Readonly<Record<PlaceSize, number>> = { 1: 3.2, 2: 4.6, 3: 6.2, 4: 8 };

/** Corps du libellé, en pixels. */
const FONT_SIZE_PX: Readonly<Record<PlaceSize, number>> = { 1: 10, 2: 12, 3: 14, 4: 17 };

/**
 * Zoom, en pixels par degré, à partir duquel chaque importance apparaît.
 * Au plus large, seules les grandes villes sont nommées : c'est ce qui rend la
 * carte lisible plutôt qu'encombrée.
 */
const MIN_ZOOM_FOR_SIZE: Readonly<Record<PlaceSize, number>> = { 4: 0, 3: 5, 2: 11, 1: 22 };

/** Ordre de préséance quand deux libellés se disputent la même place. */
const KIND_PRIORITY: Readonly<Record<PlaceKind, number>> = {
  city: 0,
  fortress: 1,
  town: 2,
  volcano: 3,
  ruin: 4,
  landmark: 5,
  village: 6,
};

export interface LabelLayer {
  readonly container: Container;
  setPlaces: (places: readonly Place[]) => void;
  setSelected: (id: string | undefined) => void;
  setTime: (ringConfig: RingConfig, tDays: number) => void;
  setViewport: (viewport: Viewport) => void;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
}

export function createLabelLayer(): LabelLayer {
  const container = new Container();
  const icons = new Graphics();
  container.addChild(icons);

  const labels = new Container();
  container.addChild(labels);

  let places: readonly Place[] = [];
  let texts: Text[] = [];
  let selectedId: string | undefined;
  let ringConfig: RingConfig | undefined;
  let tDays = 0;
  let viewport: Viewport | undefined;

  const styleFor = (size: PlaceSize): TextStyle =>
    new TextStyle({
      fontFamily: 'Georgia, Cambria, "Times New Roman", serif',
      fontSize: FONT_SIZE_PX[size],
      fill: 0x2b2118,
      // Un liseré de parchemin détache le nom du fond sans l'encadrer.
      stroke: { color: 0xe8dcc0, width: 3, join: 'round' },
      fontStyle: size >= 3 ? 'normal' : 'italic',
    });

  /**
   * Les textes ne dépendent que du nom et de l'importance : un lieu qu'on
   * glisse garde les siens. Les recréer à chaque pas de souris coûterait un
   * rendu de police par lieu et par image.
   */
  const sameTexts = (previous: readonly Place[], next: readonly Place[]): boolean =>
    previous.length === next.length &&
    next.every((place, i) => place.name === previous[i]?.name && place.size === previous[i]?.size);

  const rebuildTexts = (): void => {
    for (const text of texts) text.destroy();
    labels.removeChildren();
    texts = places.map((place) => {
      const text = new Text({ text: place.name, style: styleFor(place.size) });
      text.anchor.set(0, 0.5);
      text.visible = false;
      labels.addChild(text);
      return text;
    });
  };

  const draw = (): void => {
    icons.clear();
    for (const text of texts) text.visible = false;
    if (!viewport || !ringConfig) return;

    const { widthPx, heightPx, pixelsPerDegree } = viewport;

    // Les plus importants passent les premiers : en cas de dispute, c'est le
    // village qui renonce, jamais la capitale.
    const order = places
      .map((place, index) => ({ place, index }))
      .filter(({ place }) => pixelsPerDegree >= MIN_ZOOM_FOR_SIZE[place.size])
      .sort(
        (a, b) =>
          b.place.size - a.place.size ||
          KIND_PRIORITY[a.place.kind] - KIND_PRIORITY[b.place.kind] ||
          a.index - b.index,
      );

    const taken: Rect[] = [];
    const margin = 40;
    let selectedDrawn = false;

    for (const { place, index } of order) {
      const lonWorld = localToWorldLon(place.lon, place.lat, ringConfig, tDays);
      const point = worldToScreen(viewport, { lon: lonWorld, lat: place.lat });

      if (
        point.x < -margin ||
        point.x > widthPx + margin ||
        point.y < -margin ||
        point.y > heightPx + margin
      ) {
        continue;
      }

      const radius = ICON_RADIUS_PX[place.size];
      const box = iconRect(point.x, point.y, radius);

      // Une icône qui en recouvre une autre est simplement omise.
      if (taken.some((rect) => overlaps(rect, box))) continue;

      drawPlaceIcon(icons, place.kind, point.x, point.y, radius);
      taken.push(box);
      if (place.id === selectedId) selectedDrawn = true;

      const text = texts[index];
      if (!text) continue;

      const w = text.width;
      const h = text.height;
      const free = findLabelSpot(point.x, point.y, radius, w, h, taken);

      // Aucune place libre : on garde l'icône et on renonce au nom. Mieux vaut
      // un lieu anonyme qu'un empilement illisible.
      if (!free) continue;

      text.position.set(free.x, free.y);
      text.visible = true;
      taken.push(labelRect(free.x, free.y, w, h));
    }

    // Le lieu sélectionné est toujours dessiné et cerclé, même si
    // l'anti-collision ou le zoom l'ont effacé : le MJ doit voir ce qu'il
    // retouche, à commencer par le lieu qu'il vient de poser.
    const selected = places.find((place) => place.id === selectedId);
    if (selected) {
      const lonWorld = localToWorldLon(selected.lon, selected.lat, ringConfig, tDays);
      const point = worldToScreen(viewport, { lon: lonWorld, lat: selected.lat });
      if (!selectedDrawn) {
        drawPlaceIcon(icons, selected.kind, point.x, point.y, ICON_RADIUS_PX[selected.size]);
      }
      const radius = ICON_RADIUS_PX[selected.size] + 5;
      icons
        .circle(point.x, point.y, radius)
        .stroke({ width: 2, color: 0x8a2b1a, alpha: 0.9 })
        .circle(point.x, point.y, radius + 2.5)
        .stroke({ width: 1, color: 0xe8dcc0, alpha: 0.9 });
    }
  };

  return {
    container,
    setPlaces: (next) => {
      const keep = sameTexts(places, next);
      places = next;
      if (!keep) rebuildTexts();
      draw();
    },
    setSelected: (id) => {
      selectedId = id;
      draw();
    },
    setTime: (config, days) => {
      ringConfig = config;
      tDays = days;
      draw();
    },
    setViewport: (next) => {
      viewport = next;
      draw();
    },
    setVisible: (visible) => {
      container.visible = visible;
    },
    destroy: () => container.destroy({ children: true }),
  };
}
