/**
 * Décorations d'un export PNG : cartouche, rose des vents, échelle, date,
 * bordure, et mention « Terra incognita ».
 *
 * Elles sont dessinées en Canvas 2D sur l'image déjà extraite du GPU : ce sont
 * des ornements à la taille de l'image, pas des objets du monde, et le texte y
 * est bien plus simple à composer. Voir docs/partage.md.
 */

import type { WorldRect } from '@/model/viewport';
import { scaleBar, type ExportPlan } from '@/render/exportPlan';

export interface ExportDecorations {
  /** Titre du cartouche ; vide, pas de cartouche. */
  readonly title: string;
  readonly compass: boolean;
  readonly scale: boolean;
  /** Mention de date ; vide, pas de mention. */
  readonly date: string;
  readonly border: boolean;
}

const INK = '#2b2118';
const PAPER = 'rgba(242, 232, 208, 0.92)';
const SERIF = 'Georgia, Cambria, "Times New Roman", serif';

export function drawDecorations(
  ctx: CanvasRenderingContext2D,
  plan: ExportPlan,
  rect: WorldRect,
  radiusKm: number,
  decorations: ExportDecorations,
  terraIncognita: { readonly x: number; readonly y: number } | undefined,
): void {
  const { widthPx: w, heightPx: h } = plan;
  // Tout se proportionne à l'image : un export de 1000 et un de 6000 pixels
  // doivent avoir la même allure.
  const unit = Math.max(10, Math.min(w, h) / 45);
  const margin = unit * 1.2;

  ctx.save();
  ctx.textBaseline = 'middle';

  if (terraIncognita) {
    ctx.fillStyle = 'rgba(43, 33, 24, 0.55)';
    ctx.font = `italic ${Math.round(unit * 1.6)}px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.fillText('Terra incognita', terraIncognita.x, terraIncognita.y);
  }

  if (decorations.title.trim() !== '') drawTitle(ctx, decorations.title.trim(), margin, unit);
  if (decorations.compass) drawCompass(ctx, w - margin - unit * 2.2, margin + unit * 2.2, unit * 2);
  if (decorations.scale) {
    const bar = scaleBar(rect, plan.pixelsPerDegree, radiusKm, w * 0.22);
    drawScale(ctx, bar.km, bar.lengthPx, margin, h - margin, unit);
  }
  if (decorations.date.trim() !== '') {
    const date = decorations.date.trim();
    ctx.font = `italic ${Math.round(unit)}px ${SERIF}`;
    const dateWidth = ctx.measureText(date).width;
    // Le même papier que l'échelle : la date ne se perd pas sur un trait de côte.
    ctx.fillStyle = PAPER;
    ctx.fillRect(
      w - margin - dateWidth - unit * 0.5,
      h - margin - unit * 1.1,
      dateWidth + unit,
      unit * 1.6,
    );
    ctx.textAlign = 'right';
    ctx.fillStyle = INK;
    ctx.fillText(date, w - margin, h - margin - unit * 0.3);
  }
  if (decorations.border) {
    const line = Math.max(2, unit * 0.25);
    ctx.strokeStyle = INK;
    ctx.lineWidth = line;
    ctx.strokeRect(line / 2, line / 2, w - line, h - line);
    ctx.lineWidth = line / 3;
    ctx.strokeRect(line * 2.5, line * 2.5, w - line * 5, h - line * 5);
  }

  ctx.restore();
}

function drawTitle(
  ctx: CanvasRenderingContext2D,
  title: string,
  margin: number,
  unit: number,
): void {
  ctx.font = `${Math.round(unit * 1.5)}px ${SERIF}`;
  const textWidth = ctx.measureText(title).width;
  const padX = unit;
  const boxW = textWidth + padX * 2;
  const boxH = unit * 2.6;

  ctx.fillStyle = PAPER;
  ctx.fillRect(margin, margin, boxW, boxH);
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, unit * 0.12);
  ctx.strokeRect(margin, margin, boxW, boxH);
  ctx.strokeRect(margin + unit * 0.25, margin + unit * 0.25, boxW - unit * 0.5, boxH - unit * 0.5);

  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.fillText(title, margin + padX, margin + boxH / 2);
}

/** Rose à quatre branches, nord en haut : la projection est équirectangulaire. */
function drawCompass(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const branch = (angle: number, length: number, filled: boolean): void => {
    const tipX = cx + Math.sin(angle) * length;
    const tipY = cy - Math.cos(angle) * length;
    const side = r * 0.16;
    const leftX = cx + Math.sin(angle - Math.PI / 2) * side;
    const leftY = cy - Math.cos(angle - Math.PI / 2) * side;
    const rightX = cx + Math.sin(angle + Math.PI / 2) * side;
    const rightY = cy - Math.cos(angle + Math.PI / 2) * side;
    ctx.beginPath();
    ctx.moveTo(leftX, leftY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fillStyle = filled ? INK : PAPER;
    ctx.fill();
    ctx.stroke();
  };

  for (let k = 0; k < 4; k += 1) branch((k * Math.PI) / 2, k === 0 ? r : r * 0.7, k === 0);

  ctx.fillStyle = INK;
  ctx.font = `${Math.round(r * 0.45)}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.fillText('N', cx, cy - r * 1.25);
}

function drawScale(
  ctx: CanvasRenderingContext2D,
  km: number,
  lengthPx: number,
  x: number,
  baseline: number,
  unit: number,
): void {
  const barH = unit * 0.45;
  const y = baseline - barH;

  ctx.fillStyle = PAPER;
  ctx.fillRect(x - unit * 0.4, y - unit * 1.6, lengthPx + unit * 0.8 + unit * 4, barH + unit * 2.1);

  // Quatre segments alternés, comme sur les cartes gravées.
  for (let k = 0; k < 4; k += 1) {
    ctx.fillStyle = k % 2 === 0 ? INK : PAPER;
    ctx.fillRect(x + (lengthPx / 4) * k, y, lengthPx / 4, barH);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, unit * 0.08);
  ctx.strokeRect(x, y, lengthPx, barH);

  ctx.fillStyle = INK;
  ctx.font = `${Math.round(unit * 0.8)}px ${SERIF}`;
  ctx.textAlign = 'left';
  ctx.fillText('0', x - unit * 0.2, y - unit * 0.6);
  ctx.fillText(`${km.toLocaleString('fr-FR')} km`, x + lengthPx - unit * 0.6, y - unit * 0.6);
}
