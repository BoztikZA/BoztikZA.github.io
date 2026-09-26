// Boztik Deliver — Premium Delivery Animations engine.
//
// Small, dependency-free primitives shared by every animation in
// registry.js. Nothing here knows what "Congratulations" or
// "Condolences" means — it only knows how to run a canvas particle
// system or a CSS light-sweep for a bounded duration, at a
// device-appropriate cost, and how to tear itself down completely.
//
// Every effect built on top of this file returns the same shape:
//   { play(): void, destroy(): void }
// play() is idempotent-safe to call once; destroy() is always safe to
// call, any number of times, even if play() never ran.

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const isNarrowViewport = () =>
  typeof window !== "undefined" && window.innerWidth <= 640;

/** Scales a "desktop" particle count down for small/low-power screens. */
export function scaleCount(desktopCount) {
  const n = isNarrowViewport() ? Math.round(desktopCount * 0.55) : desktopCount;
  return Math.max(1, n);
}

/* ============================================================
   EASING — small, self-contained, no library.
============================================================ */
export const ease = {
  linear: t => t,
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inCubic: t => t * t * t,
  inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  outQuad: t => 1 - (1 - t) * (1 - t),
  outBack: t => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
};

/** Smooth fade-in / hold / fade-out envelope, 0..1, for a 0..1 progress value. */
export function envelope(progress, inFrac = 0.18, outFrac = 0.28) {
  if (progress < inFrac) return ease.outQuad(progress / inFrac);
  if (progress > 1 - outFrac) return ease.outQuad((1 - progress) / outFrac);
  return 1;
}

/* ============================================================
   CANVAS STAGE — DPR-aware, fixed-size, fully self-removing.
============================================================ */
export function createCanvasStage(root, { blendSoft = false } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "deliver-anim-canvas";
  if (blendSoft) canvas.style.mixBlendMode = "screen";
  root.appendChild(canvas);
  const ctx = canvas.getContext("2d", { alpha: true });

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = root.clientWidth || window.innerWidth;
    const h = root.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize, { passive: true });

  return {
    canvas,
    ctx,
    get width() { return root.clientWidth || window.innerWidth; },
    get height() { return root.clientHeight || window.innerHeight; },
    destroy() {
      window.removeEventListener("resize", resize);
      canvas.remove();
    }
  };
}

/** requestAnimationFrame loop bounded to durationMs. Returns a cancel(). */
export function runFor(durationMs, onFrame, onDone) {
  let raf = null;
  let start = null;
  let cancelled = false;

  function frame(ts) {
    if (cancelled) return;
    if (start === null) start = ts;
    const elapsed = ts - start;
    const p = Math.min(1, elapsed / durationMs);
    onFrame(p, elapsed);
    if (p < 1) {
      raf = requestAnimationFrame(frame);
    } else {
      onDone?.();
    }
  }
  raf = requestAnimationFrame(frame);

  return () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
  };
}

/* ============================================================
   SHAPE DRAWERS — each draws centred on (0,0) at the given size;
   callers translate/rotate/scale the canvas context first.
============================================================ */
export const shapes = {
  softDot(ctx, size, color, alpha = 1) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
    g.addColorStop(0, colorWithAlpha(color, alpha));
    g.addColorStop(1, colorWithAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fill();
  },

  spark(ctx, size, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, size * 0.12);
    ctx.lineCap = "round";
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.rotate((Math.PI / 4) * (i * 2 + 1) / 2 + i * (Math.PI / 2));
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(0, size);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  },

  /** Generic jagged comic-impact starburst outline — a plain geometric
   *  shape (alternating outer/inner radius), not tied to any brand,
   *  character, or person. */
  burstStar(ctx, size, color, alpha = 1, points = 10) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? size : size * 0.46;
      const angle = (Math.PI / points) * i - Math.PI / 2;
      const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },

  petal(ctx, size, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.bezierCurveTo(size * 0.85, -size * 0.5, size * 0.7, size * 0.6, 0, size);
    ctx.bezierCurveTo(-size * 0.7, size * 0.6, -size * 0.85, -size * 0.5, 0, -size);
    ctx.fill();
    ctx.restore();
  },

  leaf(ctx, size, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.quadraticCurveTo(size * 0.95, -size * 0.2, 0, size);
    ctx.quadraticCurveTo(-size * 0.95, -size * 0.2, 0, -size);
    ctx.fill();
    ctx.strokeStyle = colorWithAlpha("#000000", 0.12);
    ctx.lineWidth = Math.max(0.5, size * 0.05);
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.85);
    ctx.lineTo(0, size * 0.85);
    ctx.stroke();
    ctx.restore();
  },

  heart(ctx, size, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const s = size * 0.62;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.6);
    ctx.bezierCurveTo(-s * 1.3, -s * 0.4, -s * 0.5, -s * 1.3, 0, -s * 0.4);
    ctx.bezierCurveTo(s * 0.5, -s * 1.3, s * 1.3, -s * 0.4, 0, s * 0.6);
    ctx.fill();
    ctx.restore();
  },

  balloon(ctx, size, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.62, size, 0, 0, Math.PI * 2);
    ctx.fill();
    // highlight
    ctx.fillStyle = colorWithAlpha("#ffffff", 0.28 * alpha);
    ctx.beginPath();
    ctx.ellipse(-size * 0.2, -size * 0.35, size * 0.16, size * 0.24, -0.4, 0, Math.PI * 2);
    ctx.fill();
    // knot
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-size * 0.12, size * 0.94);
    ctx.lineTo(size * 0.12, size * 0.94);
    ctx.lineTo(0, size * 1.12);
    ctx.closePath();
    ctx.fill();
    // string
    ctx.strokeStyle = colorWithAlpha("#c8d0da", 0.5 * alpha);
    ctx.lineWidth = Math.max(0.6, size * 0.03);
    ctx.beginPath();
    ctx.moveTo(0, size * 1.1);
    ctx.quadraticCurveTo(size * 0.35, size * 1.7, 0, size * 2.3);
    ctx.stroke();
    ctx.restore();
  },

  /** Simple silhouette wing-bird; wingPhase -1..1 controls the flap. */
  dove(ctx, size, color, wingPhase, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const flap = wingPhase * size * 0.55;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(size * 0.5, -size * 0.15, size * 1.1, -flap);
    ctx.quadraticCurveTo(size * 0.55, size * 0.05, 0, 0);
    ctx.quadraticCurveTo(-size * 0.55, size * 0.05, -size * 1.1, -flap);
    ctx.quadraticCurveTo(-size * 0.5, -size * 0.15, 0, 0);
    ctx.fill();
    // body + head
    ctx.beginPath();
    ctx.ellipse(0, size * 0.05, size * 0.32, size * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(size * 0.34, -size * 0.02, size * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  /** Graduation-cap silhouette (simple, flat, not cartoonish). */
  capSilhouette(ctx, size, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.55);
    ctx.lineTo(size, 0);
    ctx.lineTo(0, size * 0.55);
    ctx.lineTo(-size, 0);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.rect(-size * 0.32, size * 0.02, size * 0.64, size * 0.42);
    ctx.fill();
    ctx.strokeStyle = colorWithAlpha(color, alpha);
    ctx.lineWidth = Math.max(1, size * 0.05);
    ctx.beginPath();
    ctx.moveTo(size * 0.35, size * 0.02);
    ctx.lineTo(size * 0.55, size * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(size * 0.55, size * 0.58, size * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
};

function colorWithAlpha(hex, alpha) {
  const h = hex.replace("#", "");
  const bigint = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}
export { colorWithAlpha };

/* ============================================================
   GENERIC DRIFT-FIELD PARTICLE SYSTEM
   Covers: birthday, anniversary, wedding, new-baby, good-luck,
   get-well, christmas, with-love, farewell — differentiated purely
   by config (shape, palette, direction, gravity, spawn region).
   This is the "registry, not a pile of bespoke code" backbone.
============================================================ */
export function createDriftField(root, cfg) {
  const stage = createCanvasStage(root);
  let cancel = null;
  let particles = [];

  function spawn() {
    const n = scaleCount(cfg.count);
    particles = Array.from({ length: n }, () => cfg.spawn(stage.width, stage.height));
  }

  function frameParticle(pt, dtSec) {
    pt.x += pt.vx * dtSec;
    pt.y += pt.vy * dtSec;
    pt.vy += (cfg.gravity ?? 0) * dtSec;
    pt.vx += Math.sin((pt.t += dtSec) * (pt.swayFreq ?? 1)) * (cfg.sway ?? 0) * dtSec;
    pt.rot += pt.vr * dtSec;
  }

  return {
    play() {
      spawn();
      let last = null;
      cancel = runFor(cfg.duration, (p, elapsed) => {
        const dtSec = last === null ? 0 : (elapsed - last) / 1000;
        last = elapsed;
        stage.ctx.clearRect(0, 0, stage.width, stage.height);
        const env = envelope(p, cfg.inFrac ?? 0.15, cfg.outFrac ?? 0.3);
        for (const pt of particles) {
          frameParticle(pt, dtSec);
          stage.ctx.save();
          stage.ctx.translate(pt.x, pt.y);
          stage.ctx.rotate(pt.rot);
          const a = env * pt.baseAlpha;
          cfg.draw(stage.ctx, pt, a);
          stage.ctx.restore();
        }
      }, () => {
        stage.ctx.clearRect(0, 0, stage.width, stage.height);
      });
    },
    destroy() {
      cancel?.();
      stage.destroy();
    }
  };
}

/* ============================================================
   FIREWORKS — shared by "congratulations" and "new-year".
============================================================ */
export function createFireworks(root, cfg) {
  const stage = createCanvasStage(root);
  let cancel = null;

  function makeBurst(x, y, color, count) {
    const particles = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
      const speed = 90 + Math.random() * 140;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1.6 + Math.random() * 1.6,
        trail: []
      });
    }
    return { particles, born: null, color };
  }

  return {
    play() {
      const bursts = [];
      const w = stage.width, h = stage.height;
      const launches = cfg.launches(w, h); // [{x,y,delayMs,color,count}]
      let launched = 0;

      cancel = runFor(cfg.duration, (p, elapsed) => {
        stage.ctx.fillStyle = "rgba(0,0,0,0)";
        stage.ctx.clearRect(0, 0, w, h);

        while (launched < launches.length && elapsed >= launches[launched].delayMs) {
          const l = launches[launched];
          const b = makeBurst(l.x, l.y, l.color, scaleCount(l.count));
          b.born = elapsed;
          bursts.push(b);
          launched++;
        }

        for (const b of bursts) {
          const age = (elapsed - b.born) / 1000;
          for (const pt of b.particles) {
            pt.trail.push({ x: pt.x, y: pt.y });
            if (pt.trail.length > 6) pt.trail.shift();
            pt.x += pt.vx * 0.016;
            pt.y += pt.vy * 0.016;
            pt.vy += 70 * 0.016;
            pt.vx *= 0.985;
          }
          const life = Math.max(0, 1 - age / 1.4);
          if (life <= 0) continue;
          stage.ctx.save();
          stage.ctx.globalCompositeOperation = "lighter";
          for (const pt of b.particles) {
            stage.ctx.strokeStyle = colorWithAlpha(b.color, life * 0.5);
            stage.ctx.lineWidth = pt.size;
            stage.ctx.beginPath();
            pt.trail.forEach((t, i) => (i === 0 ? stage.ctx.moveTo(t.x, t.y) : stage.ctx.lineTo(t.x, t.y)));
            stage.ctx.lineTo(pt.x, pt.y);
            stage.ctx.stroke();
            stage.ctx.save();
            stage.ctx.translate(pt.x, pt.y);
            shapes.softDot(stage.ctx, pt.size * 2.2, b.color, life);
            stage.ctx.restore();
          }
          stage.ctx.restore();
        }
      }, () => stage.ctx.clearRect(0, 0, w, h));
    },
    destroy() {
      cancel?.();
      stage.destroy();
    }
  };
}
/* ============================================================
   DOVES — bespoke path-follow flight (condolences).
============================================================ */
export function createDoveFlight(root, cfg) {
  const stage = createCanvasStage(root);
  let cancel = null;

  return {
    play() {
      const w = stage.width, h = stage.height;
      const birds = cfg.birds(w, h); // [{path(t)->{x,y}, size, delay, span, color}]
      cancel = runFor(cfg.duration, (_p, elapsed) => {
        stage.ctx.clearRect(0, 0, w, h);
        for (const bird of birds) {
          const local = (elapsed - bird.delay) / bird.span;
          if (local < 0 || local > 1) continue;
          const pos = bird.path(ease.inOutSine(local));
          const a = envelope(local, 0.14, 0.22);
          const wing = Math.sin(elapsed / 120 + bird.phase);
          stage.ctx.save();
          stage.ctx.translate(pos.x, pos.y);
          stage.ctx.rotate(pos.angle ?? 0);
          shapes.dove(stage.ctx, bird.size, bird.color, wing, a);
          stage.ctx.restore();
        }
      }, () => stage.ctx.clearRect(0, 0, w, h));
    },
    destroy() {
      cancel?.();
      stage.destroy();
    }
  };
}

/* ============================================================
   RADIAL BURST — achievement / graduation.
============================================================ */
export function createRadialBurst(root, cfg) {
  const stage = createCanvasStage(root);
  let cancel = null;

  return {
    play() {
      const w = stage.width, h = stage.height;
      const cx = w / 2, cy = cfg.originY ? h * cfg.originY : h * 0.42;
      const rising = Array.from({ length: scaleCount(cfg.count) }, () => ({
        angle: -Math.PI / 2 + (Math.random() - 0.5) * 1.4,
        speed: 60 + Math.random() * 90,
        size: 1.4 + Math.random() * 1.8,
        delay: Math.random() * 0.35,
        x: cx, y: cy
      }));
      cancel = runFor(cfg.duration, (p, elapsed) => {
        stage.ctx.clearRect(0, 0, w, h);
        const ringP = Math.min(1, elapsed / 700);
        const ringR = ease.outCubic(ringP) * Math.min(w, h) * 0.28;
        const ringA = (1 - ringP) * 0.55;
        if (ringA > 0.01) {
          stage.ctx.save();
          stage.ctx.globalCompositeOperation = "lighter";
          const g = stage.ctx.createRadialGradient(cx, cy, Math.max(0, ringR - 18), cx, cy, ringR);
          g.addColorStop(0, colorWithAlpha(cfg.color, 0));
          g.addColorStop(0.85, colorWithAlpha(cfg.color, ringA));
          g.addColorStop(1, colorWithAlpha(cfg.color, 0));
          stage.ctx.fillStyle = g;
          stage.ctx.beginPath();
          stage.ctx.arc(cx, cy, ringR + 20, 0, Math.PI * 2);
          stage.ctx.fill();
          stage.ctx.restore();
        }
        const glowA = (1 - ringP) * 0.9;
        if (glowA > 0.02) {
          stage.ctx.save();
          stage.ctx.globalCompositeOperation = "lighter";
          shapes.softDot(withCenteredCtx(stage.ctx, cx, cy), 70 * (0.6 + ringP), cfg.color, glowA);
          restoreCtx(stage.ctx);
          stage.ctx.restore();
        }
        const t = Math.max(0, (elapsed - 200) / 1000);
        stage.ctx.save();
        stage.ctx.globalCompositeOperation = "lighter";
        for (const r of rising) {
          const lt = Math.max(0, t - r.delay);
          if (lt <= 0) continue;
          const x = cx + Math.cos(r.angle) * r.speed * lt * 0.4;
          const y = cy + Math.sin(r.angle) * r.speed * lt - 40 * lt * lt;
          const life = Math.max(0, 1 - lt / 1.3);
          if (life <= 0) continue;
          shapes.softDot(withCenteredCtx(stage.ctx, x, y), r.size * 3, cfg.color, life * 0.85);
          restoreCtx(stage.ctx);
        }
        stage.ctx.restore();
        if (cfg.icon && p > 0.08 && p < 0.85) {
          const iconA = envelope((p - 0.08) / 0.77, 0.25, 0.35);
          stage.ctx.save();
          stage.ctx.translate(cx, cy - 6);
          cfg.icon(stage.ctx, 26, iconA);
          stage.ctx.restore();
        }
      }, () => stage.ctx.clearRect(0, 0, w, h));
    },
    destroy() {
      cancel?.();
      stage.destroy();
    }
  };
}
function withCenteredCtx(ctx, x, y) { ctx.save(); ctx.translate(x, y); return ctx; }
function restoreCtx(ctx) { ctx.restore(); }

/* ============================================================
   CSS LIGHT SWEEP — welcome / best-wishes / thank-you base layer.
   Pure DOM + CSS animation: cheaper and smoother than canvas for a
   single translating gradient band.
============================================================ */
export function createLightSweep(root, cfg) {
  let el = null;
  let sparkleField = null;

  return {
    play() {
      el = document.createElement("div");
      el.className = "deliver-anim-sweep";
      // Computed here (not via CSS color-mix()) so the band works on
      // older engines without modern CSS color-function support.
      el.style.setProperty("--sweep-color-mid", colorWithAlpha(cfg.color, 0.55));
      el.style.setProperty("--sweep-duration", `${cfg.duration}ms`);
      el.style.setProperty("--sweep-width", cfg.bandWidth || "38%");
      el.style.setProperty("--sweep-angle", cfg.angle || "8deg");
      root.appendChild(el);
      el.addEventListener("animationend", () => { el?.remove(); el = null; }, { once: true });

      if (cfg.sparkles) {
        sparkleField = createDriftField(root, cfg.sparkles);
        sparkleField.play();
      }
    },
    destroy() {
      el?.remove();
      el = null;
      sparkleField?.destroy();
      sparkleField = null;
    }
  };
}

/* ============================================================
   ELEGANT SNOW — layered fall, distinct from the generic drift
   field only in that it renders three independent depth passes.
============================================================ */
export function createSnowfall(root, cfg) {
  const stage = createCanvasStage(root);
  let cancel = null;
  let layers = [];

  function makeLayer(layerCfg) {
    const n = scaleCount(layerCfg.count);
    return Array.from({ length: n }, () => ({
      x: Math.random() * stage.width,
      y: -20 - Math.random() * stage.height * 0.6,
      vy: layerCfg.speed * (0.8 + Math.random() * 0.4),
      vx: (Math.random() - 0.5) * layerCfg.sway,
      size: layerCfg.size * (0.75 + Math.random() * 0.5),
      alpha: layerCfg.alpha * (0.7 + Math.random() * 0.3),
      t: Math.random() * 10,
      blur: layerCfg.blur
    }));
  }

  return {
    play() {
      layers = cfg.layers.map(makeLayer);
      let last = null;
      cancel = runFor(cfg.duration, (p, elapsed) => {
        const dt = last === null ? 0 : (elapsed - last) / 1000;
        last = elapsed;
        stage.ctx.clearRect(0, 0, stage.width, stage.height);
        const env = envelope(p, 0.08, 0.32);
        for (const layer of layers) {
          for (const f of layer) {
            f.y += f.vy * dt;
            f.x += Math.sin((f.t += dt) * 0.6) * f.vx * dt * 30;
            if (f.y > stage.height + 20) { f.y = -20; f.x = Math.random() * stage.width; }
            stage.ctx.save();
            if (f.blur) stage.ctx.filter = `blur(${f.blur}px)`;
            shapes.softDot(withCenteredCtx(stage.ctx, f.x, f.y), f.size, cfg.color, f.alpha * env);
            restoreCtx(stage.ctx);
            stage.ctx.restore();
          }
        }
      }, () => stage.ctx.clearRect(0, 0, stage.width, stage.height));
    },
    destroy() {
      cancel?.();
      stage.destroy();
    }
  };
}

/* ============================================================
   REDUCED-MOTION FALLBACK — used for every animation id when the
   viewer has requested reduced motion. Never elaborate: a single
   soft badge fade in/out, no movement, no flashing.
============================================================ */
export function createReducedMotionFallback(root, cfg) {
  let el = null;
  return {
    play() {
      el = document.createElement("div");
      el.className = "deliver-anim-reduced-badge";
      el.style.setProperty("--badge-color", cfg.color);
      el.innerHTML = `<span class="deliver-anim-reduced-badge-icon" aria-hidden="true"></span><span>${cfg.label}</span>`;
      root.appendChild(el);
      requestAnimationFrame(() => el?.classList.add("is-visible"));
      setTimeout(() => el?.classList.remove("is-visible"), 1600);
      setTimeout(() => { el?.remove(); el = null; }, 2000);
    },
    destroy() {
      el?.remove();
      el = null;
    }
  };
}
