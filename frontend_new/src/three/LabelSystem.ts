import * as THREE from 'three';

export function makeTextSprite(text: string, color: string, fontSize = 48): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
  const metrics = ctx.measureText(text);
  const w = Math.ceil(metrics.width) + 16;
  const h = fontSize + 16;
  canvas.width = w;
  canvas.height = h;

  ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(w / 60, h / 60, 1);
  sprite.userData._labelText = text;
  sprite.userData._labelFontSize = fontSize;
  return sprite;
}

export function updateSpriteColor(sprite: THREE.Sprite, color: string) {
  const text = sprite.userData._labelText as string;
  const fontSize = (sprite.userData._labelFontSize as number) || 48;
  if (!text) return;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
  const metrics = ctx.measureText(text);
  const w = Math.ceil(metrics.width) + 16;
  const h = fontSize + 16;
  canvas.width = w;
  canvas.height = h;

  ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);

  const mat = sprite.material as THREE.SpriteMaterial;
  if (mat.map) mat.map.dispose();
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  mat.map = tex;
  mat.needsUpdate = true;
}

export function updateLabelOpacity(sprite: THREE.Sprite, camera: THREE.Camera) {
  const dist = sprite.position.distanceTo(camera.position);
  const opacity = Math.max(0.12, Math.min(1.0, 1.5 - dist / 40));
  (sprite.material as THREE.SpriteMaterial).opacity = opacity;
}

export function makeHzBadge(hz: number, health: 'stable' | 'jitter' | 'stale'): THREE.Sprite {
  const text = health === 'stale' ? '--' : `${hz.toFixed(1)} Hz`;
  const color = health === 'stable' ? '#10b981' : health === 'jitter' ? '#f59e0b' : '#ef4444';
  return makeTextSprite(text, color, 32);
}
