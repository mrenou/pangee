/**
 * Coordonnées sur le cylindre de Pangée.
 *
 * La longitude se wrap dans [-180, 180[, la latitude se clamp dans [-90, 90].
 * Jamais l'inverse. Voir docs/modele-monde.md.
 */

export const LON_MIN = -180;
export const LON_MAX = 180;
export const LAT_MIN = -90;
export const LAT_MAX = 90;

export const DEG_TO_RAD = Math.PI / 180;

/** Ramène une longitude quelconque dans [-180, 180[. */
export function wrapLon(lonDeg: number): number {
  const shifted = (((lonDeg + 180) % 360) + 360) % 360;
  return shifted - 180;
}

/** Borne une latitude dans [-90, 90]. */
export function clampLat(latDeg: number): number {
  return latDeg < LAT_MIN ? LAT_MIN : latDeg > LAT_MAX ? LAT_MAX : latDeg;
}

/**
 * Plus court écart angulaire de `from` vers `to`, dans [-180, 180[.
 * Utile pour interpoler une longitude sans faire le tour du monde.
 */
export function deltaLon(fromDeg: number, toDeg: number): number {
  return wrapLon(toDeg - fromDeg);
}

/** Kilomètres parcourus par un degré de longitude à cette latitude. */
export function kmPerDegLon(latDeg: number, radiusKm: number): number {
  return DEG_TO_RAD * radiusKm * Math.cos(clampLat(latDeg) * DEG_TO_RAD);
}

/** Kilomètres parcourus par un degré de latitude — constant sur un cylindre. */
export function kmPerDegLat(radiusKm: number): number {
  return DEG_TO_RAD * radiusKm;
}

/** Index d'une cellule dans un raster ligne par ligne. */
export function idx(x: number, y: number, width: number): number {
  return y * width + x;
}

/** Ramène une abscisse de raster dans [0, width[ par wrap. */
export function wrapX(x: number, width: number): number {
  return ((x % width) + width) % width;
}

/** Borne une ordonnée de raster dans [0, height[. */
export function clampY(y: number, height: number): number {
  return y < 0 ? 0 : y >= height ? height - 1 : y;
}

/** Longitude du centre de la colonne `x` d'un raster de largeur `width`. */
export function lonOfColumn(x: number, width: number): number {
  return wrapLon(LON_MIN + ((x + 0.5) / width) * 360);
}

/** Latitude du centre de la ligne `y` d'un raster de hauteur `height`. */
export function latOfRow(y: number, height: number): number {
  return LAT_MAX - ((y + 0.5) / height) * 180;
}

/** Colonne contenant cette longitude. */
export function columnOfLon(lonDeg: number, width: number): number {
  return wrapX(Math.floor(((wrapLon(lonDeg) - LON_MIN) / 360) * width), width);
}

/** Ligne contenant cette latitude. */
export function rowOfLat(latDeg: number, height: number): number {
  return clampY(Math.floor(((LAT_MAX - clampLat(latDeg)) / 180) * height), height);
}
