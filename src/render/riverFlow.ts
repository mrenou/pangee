/**
 * Courant des rivières : des reflets clairs qui glissent vers l'aval.
 *
 * Chaque segment de rivière devient un quad portant sa distance à la source ;
 * le shader en tire un motif de tirets qui défile avec l'horloge. Animer ne
 * coûte donc qu'un uniforme par image : la géométrie n'est reconstruite que
 * lorsque le réseau ou la date changent. Voir docs/rendu.md.
 */

import { Geometry, Mesh, Shader, UniformGroup } from 'pixi.js';
import type { RiverNetwork } from '@/hydro/rivers';

const VERTEX = /* glsl */ `#version 300 es
in vec2 aPosition;   // degrés, référentiel monde
in vec2 aNormal;     // normale unitaire au segment, en degrés
in float aSide;      // -1 ou +1 : bord gauche ou droit
in float aAlong;     // distance à la source, en degrés
in float aWidthPx;   // largeur du reflet à l'écran

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform float uDegPerPx;

out float vAlongPx;
out float vSide;

void main() {
  // La largeur est tenue en pixels : on l'exprime en degrés au zoom courant.
  vec2 p = aPosition + aNormal * aSide * aWidthPx * 0.5 * uDegPerPx;
  vAlongPx = aAlong / uDegPerPx;
  vSide = aSide;
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(p, 1.0)).xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in float vAlongPx;
in float vSide;
out vec4 fragColor;

uniform float uTimeS;

void main() {
  // Un reflet tous les 26 pixels, qui avance d'un peu moins d'un pas par seconde.
  float phase = fract(vAlongPx / 26.0 - uTimeS * 0.8);
  float dash = smoothstep(0.0, 0.12, phase) * (1.0 - smoothstep(0.3, 0.45, phase));
  float edge = 1.0 - abs(vSide);
  float alpha = dash * edge * 0.6;
  fragColor = vec4(vec3(0.86, 0.93, 0.95) * alpha, alpha);
}
`;

/** Part de la largeur du trait d'encre occupée par le reflet. */
const GLINT_FRACTION = 0.8;
/** En dessous, le reflet ne se verrait pas : on n'en fabrique pas. */
const MIN_GLINT_PX = 1;

export interface RiverFlow {
  /** Trois copies, comme les tracés, pour le wrap est-ouest. */
  readonly meshes: readonly Mesh<Geometry, Shader>[];
  /** Reconstruit la géométrie ; `lagAt` rattrape le retard du réseau. */
  rebuild: (
    network: RiverNetwork | undefined,
    lagAt: (lat: number) => number,
    baseWidthPx: number,
  ) => void;
  setZoom: (pixelsPerDegree: number) => void;
  setTime: (timeS: number) => void;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
}

export function createRiverFlow(copies: number): RiverFlow {
  const uniforms = new UniformGroup({
    uDegPerPx: { value: 1, type: 'f32' },
    uTimeS: { value: 0, type: 'f32' },
  });
  const shader = Shader.from({
    gl: { vertex: VERTEX, fragment: FRAGMENT },
    resources: { flowUniforms: uniforms },
  });

  let geometry = emptyGeometry();
  const meshes = Array.from({ length: copies }, () => {
    const mesh = new Mesh({ geometry, shader });
    mesh.visible = false;
    return mesh;
  });
  let visible = false;
  let empty = true;

  return {
    meshes,
    rebuild: (network, lagAt, baseWidthPx) => {
      const next = network ? buildGeometry(network, lagAt, baseWidthPx) : undefined;
      const old = geometry;
      geometry = next ?? emptyGeometry();
      empty = next === undefined;
      for (const mesh of meshes) {
        mesh.geometry = geometry;
        mesh.visible = visible && !empty;
      }
      old.destroy();
    },
    setZoom: (pixelsPerDegree) => {
      uniforms.uniforms.uDegPerPx = 1 / pixelsPerDegree;
      uniforms.update();
    },
    setTime: (timeS) => {
      uniforms.uniforms.uTimeS = timeS;
      uniforms.update();
    },
    setVisible: (next) => {
      visible = next;
      for (const mesh of meshes) mesh.visible = visible && !empty;
    },
    destroy: () => {
      for (const mesh of meshes) mesh.destroy();
      geometry.destroy();
      shader.destroy();
    },
  };
}

/** Un triangle dégénéré : un mesh doit toujours avoir une géométrie valide. */
function emptyGeometry(): Geometry {
  return new Geometry({
    attributes: {
      aPosition: new Float32Array(6),
      aNormal: new Float32Array(6),
      aSide: new Float32Array(3),
      aAlong: new Float32Array(3),
      aWidthPx: new Float32Array(3),
    },
    indexBuffer: new Uint32Array([0, 1, 2]),
  });
}

function buildGeometry(
  network: RiverNetwork,
  lagAt: (lat: number) => number,
  baseWidthPx: number,
): Geometry | undefined {
  const { points, starts } = network;
  const riverCount = Math.max(0, starts.length - 1);

  // Premier passage : compter les segments assez larges pour porter un reflet.
  let segments = 0;
  for (let r = 0; r < riverCount; r += 1) {
    for (let p = starts[r]!; p < starts[r + 1]! - 1; p += 1) {
      if (points[p * 3 + 2]! * baseWidthPx * GLINT_FRACTION >= MIN_GLINT_PX) segments += 1;
    }
  }
  if (segments === 0) return undefined;

  const position = new Float32Array(segments * 8);
  const normal = new Float32Array(segments * 8);
  const side = new Float32Array(segments * 4);
  const along = new Float32Array(segments * 4);
  const widthPx = new Float32Array(segments * 4);
  const index = new Uint32Array(segments * 6);

  const vertex = (
    v: number,
    lon: number,
    lat: number,
    nx: number,
    ny: number,
    sign: number,
    at: number,
    w: number,
  ): void => {
    position[v * 2] = lon;
    position[v * 2 + 1] = lat;
    normal[v * 2] = nx;
    normal[v * 2 + 1] = ny;
    side[v] = sign;
    along[v] = at;
    widthPx[v] = w;
  };

  let s = 0;
  for (let r = 0; r < riverCount; r += 1) {
    let distance = 0;
    for (let p = starts[r]!; p < starts[r + 1]! - 1; p += 1) {
      const latA = points[p * 3 + 1]!;
      const latB = points[(p + 1) * 3 + 1]!;
      const lonA = points[p * 3]! + lagAt(latA);
      const lonB = points[(p + 1) * 3]! + lagAt(latB);
      const dx = lonB - lonA;
      const dy = latB - latA;
      const length = Math.hypot(dx, dy);
      const from = distance;
      distance += length;

      const w = points[p * 3 + 2]! * baseWidthPx * GLINT_FRACTION;
      if (w < MIN_GLINT_PX || length === 0) continue;

      const nx = -dy / length;
      const ny = dx / length;
      const v = s * 4;
      vertex(v, lonA, latA, nx, ny, -1, from, w);
      vertex(v + 1, lonA, latA, nx, ny, 1, from, w);
      vertex(v + 2, lonB, latB, nx, ny, -1, distance, w);
      vertex(v + 3, lonB, latB, nx, ny, 1, distance, w);
      const i = s * 6;
      index[i] = v;
      index[i + 1] = v + 1;
      index[i + 2] = v + 2;
      index[i + 3] = v + 1;
      index[i + 4] = v + 3;
      index[i + 5] = v + 2;
      s += 1;
    }
  }

  return new Geometry({
    attributes: {
      aPosition: position,
      aNormal: normal,
      aSide: side,
      aAlong: along,
      aWidthPx: widthPx,
    },
    indexBuffer: index,
  });
}
