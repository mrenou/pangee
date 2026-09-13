/**
 * Shader du terrain : un quad plein écran, une texture de relief en référentiel
 * local, et le décalage de chaque anneau passé en uniforme.
 *
 * C'est le point central du rendu : parce que le décalage est un uniforme et
 * non un assemblage CPU, il est exact au flottant et changer la date ne coûte
 * qu'une écriture d'uniforme. Voir docs/rendu.md.
 */

export const TERRAIN_VERTEX = /* glsl */ `#version 300 es
in vec2 aPosition;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

out vec2 vScreenUv;

void main() {
  // aPosition couvre [0, 1]² : le quad est ensuite étiré à la taille de l'écran.
  vScreenUv = aPosition;
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
}
`;

export const TERRAIN_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vScreenUv;
out vec4 fragColor;

uniform sampler2D uHeight;      // référentiel local, wrap est-ouest
uniform sampler2D uWaterLevel;  // référentiel monde, déjà assemblé
uniform sampler2D uFlowAcc;     // référentiel monde, déjà assemblé

// Caméra
uniform vec2  uCenter;       // (lonWorld, lat) au centre de l'écran
uniform vec2  uViewSpanDeg;  // étendue visible en degrés (lon, lat)

// Anneaux
uniform vec3  uRingOffsetDeg; // Δλ pour nord, équateur, sud
uniform vec2  uCutLat;        // (cutNorthLat, cutSouthLat)

// Monde
uniform vec2  uRasterSize;    // (width, height) du raster de relief
uniform float uSeaLevelM;
uniform float uMaxAltitudeM;
uniform float uMaxDepthM;
uniform float uShowFaults;
uniform float uHasWater;        // 0 tant que l'hydrologie n'a pas répondu
uniform float uRiverThreshold;

const float PI = 3.14159265359;

/** Décalage de l'anneau auquel appartient cette latitude. Sans branche. */
float ringOffsetDeg(float lat) {
  float north = step(uCutLat.x, lat);        // lat >= cutNorth
  float south = step(lat, uCutLat.y);        // lat <= cutSouth
  float mid   = 1.0 - north - south;
  return north * uRingOffsetDeg.x + mid * uRingOffsetDeg.y + south * uRingOffsetDeg.z;
}

/** Coordonnée de texture locale d'un point monde, à la date courante. */
vec2 localUv(vec2 lonLat) {
  float lonLocal = lonLat.x - ringOffsetDeg(lonLat.y);
  return vec2(fract((lonLocal + 180.0) / 360.0), (90.0 - lonLat.y) / 180.0);
}

/**
 * Échantillonnage bilinéaire manuel : la texture de relief est en r32float,
 * que WebGL2 n'interpole pas nativement. Le wrap en x est fait à la main pour
 * que le filtrage reste correct au méridien ±180.
 */
float sampleHeight(vec2 uv) {
  vec2 texel = 1.0 / uRasterSize;
  vec2 p = uv * uRasterSize - 0.5;
  vec2 base = floor(p);
  vec2 f = p - base;

  vec2 uv00 = (base + 0.5) * texel;
  float h00 = texture(uHeight, vec2(fract(uv00.x), clamp(uv00.y, 0.0, 1.0))).r;
  float h10 = texture(uHeight, vec2(fract(uv00.x + texel.x), clamp(uv00.y, 0.0, 1.0))).r;
  float h01 = texture(uHeight, vec2(fract(uv00.x), clamp(uv00.y + texel.y, 0.0, 1.0))).r;
  float h11 = texture(uHeight, vec2(fract(uv00.x + texel.x), clamp(uv00.y + texel.y, 0.0, 1.0))).r;

  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

/** Palette parchemin : sépias pour les terres, bleus délavés pour les mers. */
vec3 landColor(float t) {
  vec3 shore   = vec3(0.847, 0.812, 0.667);
  vec3 plain   = vec3(0.772, 0.745, 0.573);
  vec3 hill    = vec3(0.678, 0.620, 0.447);
  vec3 mountain= vec3(0.545, 0.467, 0.353);
  vec3 peak    = vec3(0.898, 0.878, 0.831);

  vec3 c = mix(shore, plain, smoothstep(0.00, 0.12, t));
  c = mix(c, hill,     smoothstep(0.12, 0.35, t));
  c = mix(c, mountain, smoothstep(0.35, 0.70, t));
  c = mix(c, peak,     smoothstep(0.85, 1.00, t));
  return c;
}

vec3 seaColor(float t) {
  vec3 shallow = vec3(0.639, 0.706, 0.714);
  vec3 mid     = vec3(0.494, 0.596, 0.635);
  vec3 deep    = vec3(0.341, 0.443, 0.506);
  vec3 c = mix(shallow, mid, smoothstep(0.0, 0.35, t));
  return mix(c, deep, smoothstep(0.35, 1.0, t));
}

void main() {
  // Écran → monde. vScreenUv.y descend, la latitude monte.
  vec2 lonLat = vec2(
    uCenter.x + (vScreenUv.x - 0.5) * uViewSpanDeg.x,
    uCenter.y - (vScreenUv.y - 0.5) * uViewSpanDeg.y
  );

  if (abs(lonLat.y) > 90.0) {
    // Au-delà des pôles : hors planète, on laisse le parchemin nu.
    fragColor = vec4(0.831, 0.769, 0.627, 1.0);
    return;
  }

  vec2 uv = localUv(lonLat);
  float h = sampleHeight(uv);

  // Les couches d'eau sont déjà assemblées : on les lit sans décalage.
  vec2 worldUv = vec2(fract((lonLat.x + 180.0) / 360.0), (90.0 - lonLat.y) / 180.0);
  float waterLevel = texture(uWaterLevel, worldUv).r;
  float flowAcc = texture(uFlowAcc, worldUv).r;

  // Tant que l'hydrologie n'a pas répondu, le niveau de la mer sert de
  // surface d'eau : le terrain ne doit jamais attendre l'eau pour s'afficher.
  bool submerged = uHasWater > 0.5 ? waterLevel > h : h < uSeaLevelM;
  float surfaceM = uHasWater > 0.5 ? waterLevel : uSeaLevelM;
  float depthOrAlt = submerged ? h - surfaceM : h - uSeaLevelM;

  // Ombrage de relief : gradient en différences finies, sur un pas d'un texel
  // de raster converti en degrés, pour rester stable à tous les zooms.
  float stepDeg = 360.0 / uRasterSize.x;
  float hx = sampleHeight(localUv(lonLat + vec2(stepDeg, 0.0)))
           - sampleHeight(localUv(lonLat - vec2(stepDeg, 0.0)));
  float hy = sampleHeight(localUv(lonLat + vec2(0.0, stepDeg)))
           - sampleHeight(localUv(lonLat - vec2(0.0, stepDeg)));

  vec3 color;
  if (!submerged) {
    float t = clamp(depthOrAlt / uMaxAltitudeM, 0.0, 1.0);
    color = landColor(t);

    // Lumière rasante venue du nord-ouest, comme sur une carte gravée.
    float shade = clamp(0.5 + (hx * 0.5 + hy * 0.5) / 900.0, 0.15, 1.0);
    color *= mix(0.78, 1.14, shade);
  } else {
    // Un lac de montagne est peu profond : on étale la palette sur sa propre
    // profondeur, pas sur celle des grands fonds.
    float depth = surfaceM - h;
    float t = clamp(depth / uMaxDepthM, 0.0, 1.0);
    color = seaColor(t);
  }

  // Trait d'encre sur le trait de côte : on détecte le passage par zéro dans
  // le voisinage immédiat, à une largeur constante à l'écran.
  float coastWidth = max(stepDeg, uViewSpanDeg.y / 400.0);
  float hE = sampleHeight(localUv(lonLat + vec2(coastWidth, 0.0))) - surfaceM;
  float hW = sampleHeight(localUv(lonLat - vec2(coastWidth, 0.0))) - surfaceM;
  float hN = sampleHeight(localUv(lonLat + vec2(0.0, coastWidth))) - surfaceM;
  float hS = sampleHeight(localUv(lonLat - vec2(0.0, coastWidth))) - surfaceM;
  float minN = min(min(hE, hW), min(hN, hS));
  float maxN = max(max(hE, hW), max(hN, hS));
  float coast = step(minN, 0.0) * step(0.0, maxN);
  color = mix(color, vec3(0.169, 0.129, 0.094), coast * 0.75);

  // Rivières : l'encre s'installe quand la surface drainée dépasse le seuil,
  // et fonce avec le débit. Le trait à largeur variable viendra avec le style.
  if (uHasWater > 0.5 && !submerged && flowAcc > uRiverThreshold) {
    float strength = clamp(log2(flowAcc / uRiverThreshold) / 6.0, 0.0, 1.0);
    vec3 riverInk = vec3(0.325, 0.427, 0.478);
    color = mix(color, riverInk, 0.35 + 0.55 * strength);
  }

  // Trait de faille : la latitude de coupure, où le cisaillement a lieu.
  float faultWidth = uViewSpanDeg.y / 300.0;
  float fault = step(abs(lonLat.y - uCutLat.x), faultWidth)
              + step(abs(lonLat.y - uCutLat.y), faultWidth);
  color = mix(color, vec3(0.353, 0.208, 0.161), clamp(fault, 0.0, 1.0) * 0.45 * uShowFaults);

  // Grain de parchemin, déterministe et sans texture.
  float grain = fract(sin(dot(lonLat, vec2(12.9898, 78.233))) * 43758.5453);
  color *= 0.97 + 0.06 * grain;

  fragColor = vec4(color, 1.0);
}
`;
