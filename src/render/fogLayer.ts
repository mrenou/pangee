/**
 * Brouillard de guerre : un quad plein écran posé au-dessus de toutes les
 * couches.
 *
 * Le masque est en référentiel local, comme le relief, et lu avec les mêmes
 * décalages d'anneaux : ce que les joueurs ont vu suit le terrain quand
 * l'anneau tourne. Parce qu'il recouvre aussi les symboles, les routes et les
 * libellés, le même calque sert l'aperçu dans l'éditeur — un voile — et
 * l'export — un parchemin opaque qui ne laisse rien filtrer.
 * Voir docs/partage.md.
 */

import type { Geometry } from 'pixi.js';
import { BufferImageSource, Mesh, Shader, Texture, UniformGroup } from 'pixi.js';
import type { RasterSize } from '@/model/world';
import { TERRAIN_VERTEX } from '@/render/terrainShader';

/** Aucun brouillard, voile d'aperçu, ou parchemin d'export. */
export type FogMode = 'off' | 'preview' | 'export';

const MODE_VALUE: Readonly<Record<FogMode, number>> = { off: 0, preview: 1, export: 2 };

const FOG_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vScreenUv;
out vec4 fragColor;

uniform sampler2D uFog;       // référentiel local, wrap est-ouest

uniform vec2  uCenter;
uniform vec2  uViewSpanDeg;
uniform vec3  uRingOffsetDeg;
uniform vec2  uCutLat;

uniform float uFogMode;       // 0 = rien, 1 = aperçu, 2 = export
uniform vec2  uFogSize;

float ringOffsetDeg(float lat) {
  float north = step(uCutLat.x, lat);
  float south = step(lat, uCutLat.y);
  return dot(vec3(north, 1.0 - north - south, south), uRingOffsetDeg);
}

/**
 * Interpolation bilinéaire faite à la main, wrap en x compris : on ne dépend
 * pas du filtrage matériel, que tous les pilotes n'appliquent pas aux textures
 * à un seul canal. Sans elle, le bord du brouillard sort en blocs.
 */
float sampleFog(vec2 uv) {
  vec2 texel = 1.0 / uFogSize;
  vec2 p = uv * uFogSize - 0.5;
  vec2 base = floor(p);
  vec2 f = p - base;
  vec2 uv00 = (base + 0.5) * texel;
  float y0 = clamp(uv00.y, 0.0, 1.0);
  float y1 = clamp(uv00.y + texel.y, 0.0, 1.0);
  float a = texture(uFog, vec2(fract(uv00.x), y0)).r;
  float b = texture(uFog, vec2(fract(uv00.x + texel.x), y0)).r;
  float c = texture(uFog, vec2(fract(uv00.x), y1)).r;
  float d = texture(uFog, vec2(fract(uv00.x + texel.x), y1)).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec2 lonLat = vec2(
    uCenter.x + (vScreenUv.x - 0.5) * uViewSpanDeg.x,
    uCenter.y - (vScreenUv.y - 0.5) * uViewSpanDeg.y
  );

  float lonLocal = lonLat.x - ringOffsetDeg(lonLat.y);
  vec2 uv = vec2(fract((lonLocal + 180.0) / 360.0), clamp((90.0 - lonLat.y) / 180.0, 0.0, 1.0));
  float revealed = sampleFog(uv);

  // Frange irrégulière : une main qui estompe, pas une découpe en cellules.
  // Le bruit est attaché au monde local, il ne flotte pas quand on se déplace.
  float cellDeg = 360.0 / uFogSize.x;
  // Plus grossier que la cellule de brouillard : un bruit plus fin moucheterait
  // le bord en vue d'ensemble au lieu de le faire onduler.
  float fringe = valueNoise(vec2(lonLocal, lonLat.y) / cellDeg * 0.6) - 0.5;
  float shown = smoothstep(0.25, 0.75, revealed + fringe * 0.3);
  float hidden = 1.0 - shown;

  if (uFogMode > 1.5) {
    // Export : parchemin vierge, opaque, avec sa fibre. Rien ne transparaît.
    float grain = valueNoise(lonLat * 12.0) * 0.6 + valueNoise(lonLat * 47.0) * 0.4;
    vec3 parchment = vec3(0.886, 0.835, 0.706) * (0.93 + 0.1 * grain);
    fragColor = vec4(parchment * hidden, hidden);
  } else {
    // Aperçu : un voile sépia, assez léger pour que le MJ voie ce qu'il cache.
    float alpha = hidden * 0.55;
    fragColor = vec4(vec3(0.22, 0.17, 0.12) * alpha, alpha);
  }
}
`;

export interface FogLayer {
  readonly mesh: Mesh<Geometry, Shader>;
  setFog: (size: RasterSize, fog: Uint8Array) => void;
  /** Renvoie au GPU le brouillard modifié en place par le pinceau. */
  refresh: () => void;
  setMode: (mode: FogMode) => void;
  /** Libère les textures remplacées ; à appeler après un rendu. */
  releaseRetired: () => void;
  resize: (widthPx: number, heightPx: number) => void;
  destroy: () => void;
}

function createFogTexture(size: RasterSize, data: Uint8Array): Texture {
  return new Texture({
    source: new BufferImageSource({
      resource: data,
      width: size.width,
      height: size.height,
      format: 'r8unorm',
      // Le brouillard est une quantité, donc interpolé — mais à la main, dans
      // le shader : voir sampleFog.
      scaleMode: 'nearest',
      addressModeU: 'repeat',
      addressModeV: 'clamp-to-edge',
      alphaMode: 'no-premultiply-alpha',
    }),
  });
}

/**
 * `shared` porte la caméra et les anneaux du terrain : un seul jeu
 * d'uniformes, donc le brouillard ne peut pas se désaligner du relief.
 */
export function createFogLayer(shared: UniformGroup, geometry: Geometry): FogLayer {
  const own = new UniformGroup({
    uFogMode: { value: 0, type: 'f32' },
    uFogSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
  });

  let texture = createFogTexture({ width: 1, height: 1 }, new Uint8Array([255]));
  let size: RasterSize = { width: 1, height: 1 };
  const retired: Texture[] = [];

  const shader = Shader.from({
    gl: { vertex: TERRAIN_VERTEX, fragment: FOG_FRAGMENT },
    resources: {
      uFog: texture.source,
      uFogSampler: texture.source.style,
      uniforms: shared,
      fogUniforms: own,
    },
  });

  const mesh = new Mesh({ geometry, shader });
  mesh.visible = false;

  return {
    mesh,
    setFog: (nextSize, fog) => {
      if (nextSize.width === size.width && nextSize.height === size.height) {
        texture.source.resource = fog;
        texture.source.update();
        return;
      }
      // L'ancienne texture est encore liée au shader jusqu'au prochain rendu.
      retired.push(texture);
      texture = createFogTexture(nextSize, fog);
      size = nextSize;
      shader.resources.uFog = texture.source;
      shader.resources.uFogSampler = texture.source.style;
      const fogSize = own.uniforms.uFogSize as Float32Array;
      fogSize[0] = nextSize.width;
      fogSize[1] = nextSize.height;
      own.update();
    },
    refresh: () => texture.source.update(),
    releaseRetired: () => {
      while (retired.length > 0) retired.pop()?.destroy(true);
    },
    setMode: (mode) => {
      own.uniforms.uFogMode = MODE_VALUE[mode];
      own.update();
      mesh.visible = mode !== 'off';
    },
    resize: (widthPx, heightPx) => mesh.scale.set(widthPx, heightPx),
    destroy: () => {
      texture.destroy(true);
      for (const old of retired) old.destroy(true);
      retired.length = 0;
    },
  };
}
