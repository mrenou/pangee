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
uniform sampler2D uBiome;       // référentiel monde, déjà assemblé

// Caméra
uniform vec2  uCenter;       // (lonWorld, lat) au centre de l'écran
uniform vec2  uViewSpanDeg;  // étendue visible en degrés (lon, lat)

// Anneaux
uniform vec3  uRingOffsetDeg;      // Δλ pour nord, équateur, sud
uniform vec3  uWaterRingOffsetDeg; // Δλ à la date où l'eau a été calculée
uniform vec2  uCutLat;        // (cutNorthLat, cutSouthLat)

// Monde
uniform vec2  uRasterSize;    // (width, height) du raster de relief
uniform float uSeaLevelM;
uniform float uMaxAltitudeM;
uniform float uMaxDepthM;
uniform float uShowFaults;
uniform float uHasWater;        // 0 tant que l'hydrologie n'a pas répondu
uniform float uRiverThreshold;
uniform vec3 uBiomeColor[14];
uniform float uStyle;           // 0 = relief nu, 1 = carte de livre

const float PI = 3.14159265359;

/** Poids de chaque anneau pour cette latitude. Sans branche. */
vec3 ringMix(float lat) {
  float north = step(uCutLat.x, lat);        // lat >= cutNorth
  float south = step(lat, uCutLat.y);        // lat <= cutSouth
  return vec3(north, 1.0 - north - south, south);
}

/** Décalage de l'anneau auquel appartient cette latitude. */
float ringOffsetDeg(float lat) {
  return dot(ringMix(lat), uRingOffsetDeg);
}

/**
 * Retard des couches d'eau sur le terrain.
 *
 * Elles ont été assemblées à une date antérieure et arrivent après coup. Plutôt
 * que de les afficher là où elles ne sont plus, on les lit décalées de ce que
 * leur anneau a parcouru depuis : lacs et rivières glissent alors avec la
 * terre, et le prochain calcul corrige la forme.
 */
float waterLagDeg(float lat) {
  return dot(ringMix(lat), uRingOffsetDeg - uWaterRingOffsetDeg);
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

/** Bruit de valeur, tuilable en longitude, pour le grain et les hachures. */
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/** Fibre du parchemin : deux octaves suffisent, on cherche une matière. */
float parchmentGrain(vec2 lonLat) {
  float g = valueNoise(lonLat * 12.0) * 0.6 + valueNoise(lonLat * 47.0) * 0.4;
  return g;
}

vec3 seaColor(float t) {
  vec3 shallow = vec3(0.639, 0.706, 0.714);
  vec3 mid     = vec3(0.494, 0.596, 0.635);
  vec3 deep    = vec3(0.341, 0.443, 0.506);
  vec3 c = mix(shallow, mid, smoothstep(0.0, 0.35, t));
  return mix(c, deep, smoothstep(0.35, 1.0, t));
}

/**
 * Les eaux douces sont plus claires et plus franches que la mer.
 *
 * Sans cela, un lac prend exactement la teinte d'une eau côtière et se perd
 * dans la carte : on sait qu'il y en a deux mille, on n'en distingue aucun.
 */
vec3 lakeColor(float t) {
  vec3 shallow = vec3(0.678, 0.769, 0.788);
  vec3 deep    = vec3(0.475, 0.604, 0.659);
  return mix(shallow, deep, smoothstep(0.0, 1.0, t));
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

  // Le niveau d'eau saute brutalement d'une cellule sèche à une cellule noyée :
  // il ne peut donc pas être interpolé, et une rive de lac sortirait en
  // marches d'escalier. On perturbe la lecture d'une fraction de cellule, ce
  // qui donne une rive irrégulière — ce que ferait une main qui dessine.
  float cellDeg = 360.0 / uRasterSize.x;
  vec2 shoreWobble = vec2(
    valueNoise(lonLat * 21.0) - 0.5,
    valueNoise(lonLat * 21.0 + 11.7) - 0.5
  ) * cellDeg * 1.1;
  float lag = waterLagDeg(lonLat.y);
  vec2 waterUv = vec2(
    fract((lonLat.x - lag + shoreWobble.x + 180.0) / 360.0),
    clamp((90.0 - lonLat.y - shoreWobble.y) / 180.0, 0.0, 1.0)
  );

  float waterLevel = texture(uWaterLevel, waterUv).r;
  vec2 laggedUv = vec2(fract((lonLat.x - lag + 180.0) / 360.0), worldUv.y);
  float flowAcc = texture(uFlowAcc, laggedUv).r;
  // Le biome est catégoriel, donc échantillonné au plus proche : à fort zoom,
  // ses frontières seraient des marches d'escalier d'une cellule. On perturbe
  // la coordonnée de lecture d'environ une cellule, ce qui rend les limites
  // irrégulières sans jamais inventer de biome intermédiaire.
  float biomeJitterDeg = 360.0 / uRasterSize.x;
  vec2 biomeWobble = vec2(
    valueNoise(lonLat * 9.0) - 0.5,
    valueNoise(lonLat * 9.0 + 31.4) - 0.5
  ) * biomeJitterDeg * 1.6;
  vec2 biomeUv = vec2(
    fract((lonLat.x - lag + biomeWobble.x + 180.0) / 360.0),
    clamp((90.0 - lonLat.y - biomeWobble.y) / 180.0, 0.0, 1.0)
  );
  int biomeId = int(texture(uBiome, biomeUv).r * 255.0 + 0.5);

  // La surface d'eau est la plus haute des deux : le niveau de la mer, connu
  // tout de suite, et le plan d'eau calculé par l'hydrologie, qui arrive après
  // coup et n'apporte que les lacs et les mers intérieures.
  //
  // C'est ce qui permet de relever la mer et de la voir monter sur-le-champ.
  // S'en remettre au seul waterLevel laissait les terres basses pâlir sans
  // jamais passer au bleu, tant que le calcul n'était pas revenu.
  //
  // Contrepartie assumée : une cuvette fermée dont le plan d'eau est plus bas
  // que la mer est affichée au niveau de la mer. Elle est noyée de toute façon,
  // et l'écart ne se voit pas à cette échelle.
  float lakeSurfaceM = uHasWater > 0.5 ? waterLevel : -1e9;
  float surfaceM = max(uSeaLevelM, lakeSurfaceM);
  bool submerged = surfaceM > h;
  // Une eau perchée au-dessus du niveau marin est douce. Les rares cuvettes
  // fermées plus basses que la mer passent pour marines : l'écart ne se voit
  // pas, et cela évite de transporter une couche de plus jusqu'au shader.
  bool isLake = submerged && lakeSurfaceM > uSeaLevelM + 1.0;
  float depthOrAlt = h - surfaceM;

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

    // La teinte vient du biome, le modelé vient du relief. En dessous d'un
    // certain style, on garde la seule rampe d'altitude.
    vec3 fromRelief = landColor(t);
    vec3 fromBiome = uHasWater > 0.5 ? uBiomeColor[clamp(biomeId, 0, 13)] : fromRelief;
    color = mix(fromRelief, mix(fromBiome, fromRelief, 0.35), uStyle);

    // Les sommets restent clairs quel que soit le biome : c'est la neige.
    color = mix(color, vec3(0.898, 0.878, 0.831), smoothstep(0.75, 1.0, t) * 0.85);

    // Lumière rasante venue du nord-ouest, comme sur une carte gravée.
    float shade = clamp(0.5 + (hx * 0.5 + hy * 0.5) / 900.0, 0.15, 1.0);
    color *= mix(0.78, 1.14, shade);
  } else {
    float depth = surfaceM - h;

    if (isLake) {
      // Un lac est peu profond : on étale sa palette sur quelques centaines de
      // mètres, et non sur celle des grands fonds, sinon il ressort uniforme.
      color = lakeColor(clamp(depth / 400.0, 0.0, 1.0));
    } else {
      color = seaColor(clamp(depth / uMaxDepthM, 0.0, 1.0));
    }
  }

  // Trait de côte, et hachures parallèles au large.
  //
  // On n'a pas de distance signée au trait de côte : on l'approche par la
  // hauteur d'eau divisée par la pente locale, ce qui donne, en degrés, la
  // distance au passage par zéro. C'est exact sur une plage régulière et
  // suffisant partout ailleurs.
  float coastWidth = max(stepDeg, uViewSpanDeg.y / 400.0);
  float hE = sampleHeight(localUv(lonLat + vec2(coastWidth, 0.0))) - surfaceM;
  float hW = sampleHeight(localUv(lonLat - vec2(coastWidth, 0.0))) - surfaceM;
  float hN = sampleHeight(localUv(lonLat + vec2(0.0, coastWidth))) - surfaceM;
  float hS = sampleHeight(localUv(lonLat - vec2(0.0, coastWidth))) - surfaceM;
  float minN = min(min(hE, hW), min(hN, hS));
  float maxN = max(max(hE, hW), max(hN, hS));
  float coast = step(minN, 0.0) * step(0.0, maxN);

  if (uStyle > 0.5 && submerged && !isLake) {
    // Hachures par paliers de profondeur, comme les bathymétries gravées : une
    // isoligne tous les cinquante mètres. L'espacement à l'écran suit alors la
    // pente du fond, serré sur un talus, large sur un plateau — et il ne
    // dépend d'aucune estimation de distance, qui devient instable dès que le
    // fond s'aplatit.
    float depth = surfaceM - h;
    float band = depth / 180.0;
    float jitter = valueNoise(lonLat * 24.0) * 0.25;
    float line = abs(fract(band + jitter) - 0.5);

    // Largeur constante à l'écran : on la mesure sur la dérivée de band.
    float width = fwidth(band) * 0.8;
    float stripe = 1.0 - smoothstep(width * 0.5, width * 1.5, line);

    // Les hachures n'accompagnent que les abords : au large, le fond est nu.
    float fade = 1.0 - smoothstep(200.0, 900.0, depth);
    color = mix(color, vec3(0.325, 0.404, 0.443), stripe * fade * 0.4);
  }

  // Le trait de côte passe par-dessus les hachures : c'est lui qui porte la
  // lecture de la carte, il ne doit jamais se noyer dans la bathymétrie. Une
  // rive de lac se trace plus légèrement qu'un littoral, comme à la plume.
  vec3 shoreInk = isLake ? vec3(0.298, 0.302, 0.278) : vec3(0.149, 0.114, 0.082);
  color = mix(color, shoreInk, coast * (isLake ? 0.6 : 0.92));

  // Les cours d'eau ne sont plus tracés ici : un test par pixel donnait des
  // marches d'escalier d'une cellule. Ils sont dessinés en polylignes à
  // largeur variable par-dessus le terrain, voir src/render/riverLayer.ts.

  // Trait de faille : la latitude de coupure, où le cisaillement a lieu.
  float faultWidth = max(uViewSpanDeg.y / 220.0, 0.02);
  float fault = step(abs(lonLat.y - uCutLat.x), faultWidth)
              + step(abs(lonLat.y - uCutLat.y), faultWidth);
  color = mix(color, vec3(0.278, 0.145, 0.106), clamp(fault, 0.0, 1.0) * 0.8 * uShowFaults);

  // Matière du parchemin : une fibre douce, plus des taches très basse
  // fréquence qui évitent les aplats trop propres.
  if (uStyle > 0.5) {
    float grain = parchmentGrain(lonLat);
    float stain = valueNoise(lonLat * 1.7);
    color *= 0.92 + 0.14 * grain;
    color = mix(color, vec3(0.804, 0.718, 0.545), stain * 0.1);

    // Vignette : les bords de la feuille ont pris le jour.
    vec2 fromCenter = (vScreenUv - 0.5) * 2.0;
    float vignette = 1.0 - dot(fromCenter, fromCenter) * 0.16;
    color *= clamp(vignette, 0.0, 1.0);
  } else {
    float grain = fract(sin(dot(lonLat, vec2(12.9898, 78.233))) * 43758.5453);
    color *= 0.97 + 0.06 * grain;
  }

  fragColor = vec4(color, 1.0);
}
`;
