// Boztik Deliver — Premium Delivery Animations catalog.
//
// This is the single source of truth for which animations exist and
// what each looks like. The Command Centre builds its <select> options
// from ANIMATION_CATALOG (see dashboard.js buildAnimationOptions()) —
// the list is never hand-duplicated in HTML. The public delivery page
// and the Command Centre's own Preview both call getAnimation(id) and
// run the exact same .create(root), so "Preview" is never a fake demo.
//
// The animation system is entirely client-side and backend-free: the
// chosen id travels to the recipient as a `?anim=` query parameter on
// the delivery link itself (see shared.js deliveryLink()). There is no
// server-side allow-list — getAnimation() below is the only validation
// that exists, and unknown/missing ids simply resolve to null (no
// animation, no theme). `theme` on each entry is consumed by theme.js
// to apply the persistent per-occasion page styling in
// css/deliver-themes.css; it is always the same as `id` so there is
// never a second list that can drift out of sync with this one.
import {
  createDriftField, createFireworks, createDoveFlight, createRadialBurst,
  createLightSweep, createSnowfall, createFloatingText, createReducedMotionFallback, combineEffects,
  prefersReducedMotion, shapes, scaleCount, colorWithAlpha
} from "./engine.js";

const rand = (a, b) => a + Math.random() * (b - a);

/* Reusable drift-field particle factories -------------------------- */
function fallingShape({ shape, colors, count, duration, gravity = 34, sway = 10, sizeMin = 9, sizeMax = 16, spawnTop = -30 }) {
  return {
    duration, count, gravity, sway, inFrac: 0.05, outFrac: 0.35,
    spawn: (w) => ({
      x: rand(0, w), y: rand(spawnTop - 200, spawnTop),
      vx: rand(-14, 14), vy: rand(28, 55),
      size: rand(sizeMin, sizeMax), rot: rand(0, Math.PI * 2), vr: rand(-1, 1),
      t: rand(0, 10), swayFreq: rand(0.5, 1.1),
      baseAlpha: rand(0.55, 0.92), color: colors[Math.floor(Math.random() * colors.length)]
    }),
    draw: (ctx, pt, a) => shapes[shape](ctx, pt.size, pt.color, a)
  };
}

function risingShape({ shape, colors, count, duration, sway = 8, sizeMin = 5, sizeMax = 11, gravity = -6 }) {
  return {
    duration, count, gravity, sway, inFrac: 0.12, outFrac: 0.35,
    spawn: (w, h) => ({
      x: rand(0, w), y: rand(h * 0.55, h + 40),
      vx: rand(-8, 8), vy: rand(-46, -22),
      size: rand(sizeMin, sizeMax), rot: rand(0, Math.PI * 2), vr: rand(-0.6, 0.6),
      t: rand(0, 10), swayFreq: rand(0.4, 0.9),
      baseAlpha: rand(0.5, 0.9), color: colors[Math.floor(Math.random() * colors.length)]
    }),
    draw: (ctx, pt, a) => shapes[shape](ctx, pt.size, pt.color, a)
  };
}

/* ------------------------------------------------------------------ */
const CATALOG = [
  {
    id: "condolences", name: "Condolences", label: "Gentle Doves",
    description: "A slow, coordinated flock of doves crosses the page together in formation and fades — quiet and respectful.",
    duration: 7200, color: "#c9d4e2",
    build(root) {
      return createDoveFlight(root, {
        duration: 7200,
        birds(w, h) {
          const baseY = h * 0.2;
          const startX = -100, endX = w + 100;
          // Every bird flies the same direction on its own vertical lane
          // (signed offset from the leader), so lanes never cross. Wing
          // birds trail slightly behind and are staggered in, for a
          // natural V-formation rather than a burst of identical paths.
          const lanes = [0, -1, 1, -2, 2, -3, 3];
          return lanes.map((lane, i) => {
            const y0 = baseY + lane * h * 0.045;
            const xLag = Math.abs(lane) * 70;
            return {
              size: 15 - Math.abs(lane) * 0.7,
              delay: Math.abs(lane) * 260 + (lane < 0 ? 0 : 40),
              span: 5600 + Math.abs(lane) * 200,
              color: "#dfe6ee", phase: i * 1.7,
              path: t => ({
                x: startX + (endX - startX) * t - xLag * (1 - t),
                y: y0 + Math.sin(t * Math.PI) * -22,
                angle: 0.04
              })
            };
          });
        }
      });
    }
  },

  {
    id: "congratulations", name: "Congratulations", label: "Confetti & Fireworks",
    description: "A soft fall of celebratory confetti with a few restrained fireworks above the delivery.",
    duration: 5000, color: "#8eff3d",
    build(root) {
      const palette = ["#8eff3d", "#ffd166", "#5fe3c2", "#ff7b9c", "#ffffff"];
      const confetti = createDriftField(root, {
        duration: 5000, count: 38, gravity: 26, sway: 12, inFrac: 0.05, outFrac: 0.35,
        spawn: (w, h) => ({
          x: rand(0, w), y: rand(-h * 0.3, h * 0.35),
          vx: rand(-20, 20), vy: rand(55, 110),
          size: rand(5, 9), rot: rand(0, Math.PI * 2), vr: rand(-6, 6),
          t: rand(0, 10), swayFreq: rand(1, 2.4),
          baseAlpha: rand(0.7, 0.95), color: palette[Math.floor(Math.random() * palette.length)]
        }),
        draw: (ctx, pt, a) => { ctx.globalAlpha = a; ctx.fillStyle = pt.color; ctx.fillRect(-pt.size / 2, -pt.size / 4, pt.size, pt.size / 2); }
      });
      const fireworks = createFireworks(root, {
        duration: 5000,
        launches: (w, h) => [
          { x: w * 0.28, y: h * 0.32, delayMs: 0, color: "#8eff3d", count: 30 },
          { x: w * 0.7, y: h * 0.24, delayMs: 650, color: "#ffd166", count: 26 },
          { x: w * 0.48, y: h * 0.3, delayMs: 1300, color: "#5fe3c2", count: 32 }
        ]
      });
      return combineEffects(confetti, fireworks);
    }
  },

  {
    id: "birthday", name: "Birthday", label: "Floating Celebration",
    description: "A large, colourful spread of balloons and confetti drifts across the whole page.",
    duration: 6200, color: "#ffd166",
    build(root) {
      const palette = ["#ff7b7b", "#5fe3c2", "#ffd166", "#a78bfa", "#8eff3d"];
      return createDriftField(root, {
        duration: 6200, count: 24, gravity: -3, sway: 13, inFrac: 0.08, outFrac: 0.3,
        spawn: (w, h) => {
          const isBalloon = Math.random() < 0.62;
          return {
            x: rand(-w * 0.04, w * 1.04), y: rand(h * 0.4, h + 140),
            vx: rand(-16, 16), vy: rand(-46, -22),
            size: isBalloon ? rand(15, 28) : rand(3, 6),
            rot: rand(-0.2, 0.2), vr: isBalloon ? rand(-0.2, 0.2) : rand(-2.4, 2.4),
            t: rand(0, 10), swayFreq: rand(0.35, 0.85),
            baseAlpha: rand(0.7, 0.96), color: palette[Math.floor(Math.random() * palette.length)],
            kind: isBalloon ? "balloon" : "confetti"
          };
        },
        draw: (ctx, pt, a) => {
          if (pt.kind === "balloon") shapes.balloon(ctx, pt.size, pt.color, a);
          else { ctx.globalAlpha = a; ctx.fillStyle = pt.color; ctx.fillRect(-pt.size / 2, -pt.size / 2, pt.size, pt.size * 0.4); }
        }
      });
    }
  },

  {
    id: "anniversary", name: "Anniversary", label: "Happy Anniversary",
    description: "An elegant \"Happy Anniversary\" travels gracefully across the page with a few soft accents.",
    duration: 5600, color: "#f2c98a",
    build(root) {
      return createFloatingText(root, {
        duration: 5600, text: "Happy Anniversary", color: "#f2c98a", travel: 14,
        accents: [
          { x: -170, y: 50, delay: 0.08, span: 0.55, scale: 1 },
          { x: 185, y: -55, delay: 0.22, span: 0.55, scale: 0.75 },
          { x: -110, y: -68, delay: 0.4, span: 0.5, scale: 0.6 },
          { x: 130, y: 62, delay: 0.5, span: 0.45, scale: 0.65 }
        ]
      });
    }
  },

  {
    id: "thank-you", name: "Thank You", label: "Golden Appreciation",
    description: "A warm golden light sweep and a graceful \"Thank You\", followed by soft glints.",
    duration: 4200, color: "#ffcf6b",
    build(root) {
      const sweep = createLightSweep(root, {
        duration: 2200, color: "#ffcf6b", bandWidth: "34%", angle: "10deg",
        sparkles: { ...risingShape({ shape: "softDot", colors: ["#ffcf6b", "#fff3d0"], count: 16, duration: 4200, sizeMin: 3, sizeMax: 6 }) }
      });
      const text = createFloatingText(root, {
        duration: 4200, text: "Thank You", color: "#ffcf6b", travel: 10,
        accents: [
          { x: -120, y: 44, delay: 0.1, span: 0.55, scale: 0.9 },
          { x: 130, y: -48, delay: 0.25, span: 0.55, scale: 0.7 }
        ]
      });
      return combineEffects(sweep, text);
    }
  },

  {
    id: "wedding", name: "Wedding", label: "Rings & Hearts",
    description: "Wedding rings and soft hearts drift gracefully across the page in champagne gold and blush, with a few elegant petals.",
    duration: 6000, color: "#e8c468",
    build(root) {
      const petalColors = ["#f3d7de", "#fbeee2", "#e8c7cf"];
      return createDriftField(root, {
        duration: 6000, count: 20, gravity: 22, sway: 10, inFrac: 0.07, outFrac: 0.32,
        spawn: (w, h) => {
          const roll = Math.random();
          const kind = roll < 0.35 ? "ring" : roll < 0.62 ? "heart" : "petal";
          return {
            x: rand(w * 0.04, w * 0.96), y: rand(-140, h * 0.55),
            vx: rand(-10, 10), vy: rand(45, 80),
            size: kind === "ring" ? rand(16, 24) : kind === "heart" ? rand(11, 17) : rand(9, 14),
            rot: rand(0, Math.PI * 2), vr: rand(-0.5, 0.5),
            t: rand(0, 10), swayFreq: rand(0.35, 0.75),
            baseAlpha: rand(0.62, 0.92),
            color: kind === "petal" ? petalColors[Math.floor(Math.random() * petalColors.length)] : "#e8c468",
            kind
          };
        },
        draw: (ctx, pt, a) => {
          if (pt.kind === "ring") shapes.ring(ctx, pt.size, pt.color, a);
          else if (pt.kind === "heart") shapes.heart(ctx, pt.size, "#e79bb0", a);
          else shapes.petal(ctx, pt.size, pt.color, a);
        }
      });
    }
  },

  {
    id: "new-baby", name: "New Baby", label: "Bottles & Pacifiers",
    description: "Baby bottles and pacifiers float gently upward in soft, gender-neutral pastel tones.",
    duration: 5200, color: "#c9e8d6",
    build(root) {
      const palette = ["#fdeec9", "#c9e8d6", "#dcd3f2", "#ffd9df"];
      return createDriftField(root, {
        duration: 5200, count: 16, gravity: -4, sway: 6, inFrac: 0.1, outFrac: 0.34,
        spawn: (w, h) => {
          const isBottle = Math.random() < 0.5;
          return {
            x: rand(w * 0.06, w * 0.94), y: rand(h * 0.3, h + 100),
            vx: rand(-8, 8), vy: rand(-58, -30),
            size: isBottle ? rand(24, 36) : rand(20, 30),
            rot: rand(-0.3, 0.3), vr: rand(-0.4, 0.4),
            t: rand(0, 10), swayFreq: rand(0.3, 0.7),
            baseAlpha: rand(0.7, 0.95), color: palette[Math.floor(Math.random() * palette.length)],
            kind: isBottle ? "bottle" : "pacifier"
          };
        },
        draw: (ctx, pt, a) => shapes[pt.kind](ctx, pt.size, pt.color, a)
      });
    }
  },

  {
    id: "graduation", name: "Graduation", label: "Cap Toss",
    description: "Graduation caps and diplomas are tossed into the air over a soft burst of gold light.",
    duration: 4600, color: "#ffd166",
    build(root) {
      const burst = createRadialBurst(root, { duration: 4600, count: 18, color: "#ffd166", originY: 0.6 });
      const toss = createDriftField(root, {
        duration: 4600, count: 14, gravity: 150, sway: 4, inFrac: 0.04, outFrac: 0.3,
        spawn: (w, h) => {
          const isCap = Math.random() < 0.62;
          return {
            x: rand(w * 0.1, w * 0.9), y: h + rand(20, 120),
            vx: rand(-40, 40), vy: -rand(260, 460),
            size: isCap ? rand(20, 30) : rand(16, 24),
            rot: rand(-0.6, 0.6), vr: rand(-2.5, 2.5),
            t: rand(0, 10), swayFreq: 1, baseAlpha: rand(0.85, 1),
            color: isCap ? "#ffd166" : "#f4e9cf", kind: isCap ? "cap" : "diploma"
          };
        },
        draw: (ctx, pt, a) => pt.kind === "cap" ? shapes.capSilhouette(ctx, pt.size, pt.color, a) : shapes.diploma(ctx, pt.size, pt.color, a)
      });
      return combineEffects(burst, toss);
    }
  },

  {
    id: "good-luck", name: "Good Luck", label: "Lucky Glow",
    description: "A soft green-and-gold glow with drifting four-leaf clovers and sparks.",
    duration: 4600, color: "#8eff3d",
    build(root) {
      const palette = ["#8eff3d", "#ffd166"];
      return createDriftField(root, {
        duration: 4600, count: 24, gravity: -5, sway: 8, inFrac: 0.1, outFrac: 0.32,
        spawn: (w, h) => {
          const roll = Math.random();
          const kind = roll < 0.16 ? "glow" : roll < 0.42 ? "clover" : "spark";
          return {
            x: rand(0, w), y: rand(h * 0.35, h + 60),
            vx: rand(-6, 6), vy: rand(-62, -28),
            size: kind === "glow" ? rand(30, 46) : kind === "clover" ? rand(17, 27) : rand(4, 8),
            rot: kind === "clover" ? rand(-0.5, 0.5) : 0, vr: kind === "clover" ? rand(-0.5, 0.5) : 0,
            t: rand(0, 10), swayFreq: rand(0.3, 0.7),
            baseAlpha: kind === "glow" ? rand(0.12, 0.2) : kind === "clover" ? rand(0.7, 0.92) : rand(0.55, 0.9),
            color: kind === "clover" ? "#6fdc6f" : palette[Math.floor(Math.random() * palette.length)], kind
          };
        },
        draw: (ctx, pt, a) => {
          if (pt.kind === "glow") shapes.softDot(ctx, pt.size, pt.color, a);
          else if (pt.kind === "clover") shapes.clover(ctx, pt.size, pt.color, a);
          else shapes.spark(ctx, pt.size, pt.color, a);
        }
      });
    }
  },

  {
    id: "get-well", name: "Get Well Soon", label: "Gentle Spring",
    description: "Slow, calming petals and soft light rise gently — supportive rather than festive.",
    duration: 5200, color: "#bfe3c9",
    build(root) {
      const palette = ["#bfe3c9", "#f4d9df", "#eaf0dc"];
      return createDriftField(root, {
        duration: 5200, count: 24, gravity: -3, sway: 6, inFrac: 0.14, outFrac: 0.36,
        spawn: (w, h) => {
          const isGlow = Math.random() < 0.4;
          return {
            x: rand(0, w), y: rand(h * 0.25, h + 60),
            vx: rand(-6, 6), vy: rand(-34, -14),
            size: isGlow ? rand(18, 32) : rand(8, 13),
            rot: rand(0, Math.PI * 2), vr: isGlow ? 0 : rand(-0.5, 0.5),
            t: rand(0, 10), swayFreq: rand(0.3, 0.7),
            baseAlpha: isGlow ? rand(0.1, 0.18) : rand(0.55, 0.85),
            color: palette[Math.floor(Math.random() * palette.length)], kind: isGlow ? "glow" : "petal"
          };
        },
        draw: (ctx, pt, a) => pt.kind === "glow" ? shapes.softDot(ctx, pt.size, pt.color, a) : shapes.petal(ctx, pt.size, pt.color, a)
      });
    }
  },

  {
    id: "christmas", name: "Merry Christmas", label: "Elegant Snow",
    description: "A fuller three-layer snowfall with depth blur — immersive without ever covering the whole screen.",
    duration: 7000, color: "#eef6ff",
    build(root) {
      return createSnowfall(root, {
        duration: 7000, color: "#eef6ff",
        layers: [
          { count: 30, speed: 26, sway: 0.6, size: 7, alpha: 0.55, blur: 0.8 },
          { count: 24, speed: 46, sway: 1, size: 5.5, alpha: 0.75, blur: 0 },
          { count: 16, speed: 72, sway: 1.5, size: 4.4, alpha: 0.96, blur: 0 }
        ]
      });
    }
  },

  {
    id: "new-year", name: "Happy New Year", label: "Midnight Celebration",
    description: "Midnight fireworks in cool blues, silver and gold, with a light fall of golden glitter.",
    duration: 5500, color: "#8fb8ff",
    build(root) {
      const glitter = createDriftField(root, {
        duration: 5500, count: 44, gravity: 10, sway: 8, inFrac: 0.08, outFrac: 0.35,
        spawn: (w, h) => ({
          x: rand(0, w), y: rand(-h * 0.2, h * 0.5),
          vx: rand(-8, 8), vy: rand(16, 42),
          size: rand(2, 4.5), rot: 0, vr: 0, t: rand(0, 10), swayFreq: rand(0.6, 1.6),
          baseAlpha: rand(0.55, 1), color: Math.random() < 0.6 ? "#ffd166" : "#dfe8ff"
        }),
        draw: (ctx, pt, a) => shapes.softDot(ctx, pt.size * 1.6, pt.color, a)
      });
      const fireworks = createFireworks(root, {
        duration: 5500,
        launches: (w, h) => [
          { x: w * 0.24, y: h * 0.3, delayMs: 0, color: "#8fb8ff", count: 28 },
          { x: w * 0.75, y: h * 0.22, delayMs: 550, color: "#f4f4f4", count: 24 },
          { x: w * 0.5, y: h * 0.34, delayMs: 1150, color: "#ffd166", count: 30 },
          { x: w * 0.35, y: h * 0.26, delayMs: 1800, color: "#8fb8ff", count: 22 }
        ]
      });
      return combineEffects(glitter, fireworks);
    }
  },

  {
    id: "welcome", name: "Welcome", label: "Light Reveal",
    description: "A soft light sweep with a quietly glowing \"Welcome\" — warm and inviting.",
    duration: 2800, color: "#8eff3d",
    build(root) {
      const sweep = createLightSweep(root, { duration: 2000, color: "#8eff3d", bandWidth: "30%", angle: "6deg" });
      const text = createFloatingText(root, { duration: 2800, text: "Welcome", color: "#b8ff7a", travel: 8 });
      return combineEffects(sweep, text);
    }
  },

  {
    id: "best-wishes", name: "Best Wishes", label: "Shimmer",
    description: "A gentle shimmer wave, elegant \"Best Wishes\" lettering and a few tiny particles.",
    duration: 3800, color: "#dfe8ff",
    build(root) {
      const sweep = createLightSweep(root, {
        duration: 1800, color: "#dfe8ff", bandWidth: "26%", angle: "4deg",
        sparkles: { ...risingShape({ shape: "softDot", colors: ["#dfe8ff"], count: 10, duration: 3800, sizeMin: 2, sizeMax: 4 }) }
      });
      const text = createFloatingText(root, {
        duration: 3800, text: "Best Wishes", color: "#dfe8ff", travel: 10,
        accents: [{ x: -110, y: 40, delay: 0.15, span: 0.5, scale: 0.7 }, { x: 120, y: -44, delay: 0.3, span: 0.5, scale: 0.6 }]
      });
      return combineEffects(sweep, text);
    }
  },

  {
    id: "with-love", name: "With Love", label: "Warm Hearts",
    description: "Translucent glowing hearts drift up the whole page at varied depth, with warm, graceful movement.",
    duration: 5000, color: "#f0a8bb",
    build(root) {
      const palette = ["#f0a8bb", "#f5c9a1", "#e79bb0"];
      return createDriftField(root, {
        duration: 5000, count: 24, gravity: -3, sway: 7, inFrac: 0.12, outFrac: 0.34,
        spawn: (w, h) => {
          const size = rand(8, 20);
          return {
            x: rand(w * 0.03, w * 0.97), y: rand(h * 0.3, h + 60),
            vx: rand(-5, 5), vy: rand(-(22 + size), -(12 + size * 0.7)),
            size, rot: rand(-0.2, 0.2), vr: rand(-0.2, 0.2), t: rand(0, 10), swayFreq: rand(0.3, 0.7),
            baseAlpha: 0.35 + (size / 20) * 0.4, color: palette[Math.floor(Math.random() * palette.length)]
          };
        },
        draw: (ctx, pt, a) => shapes.heart(ctx, pt.size, pt.color, a)
      });
    }
  },

  {
    id: "farewell", name: "Farewell", label: "Falling Leaves",
    description: "Peaceful autumn leaves drift down across the page with natural rotation and gentle wind.",
    duration: 5600, color: "#c98a4b",
    build(root) {
      const cfg = fallingShape({
        shape: "leaf", colors: ["#c98a4b", "#b56a3a", "#8a9a4e", "#d9a35f"], count: 22,
        duration: 5600, gravity: 34, sway: 16, sizeMin: 10, sizeMax: 16
      });
      const baseSpawn = cfg.spawn;
      // start part of the field already on-screen so the page is never empty at t=0
      cfg.spawn = (w, h) => ({ ...baseSpawn(w, h), y: rand(-200, h * 0.55) });
      return createDriftField(root, cfg);
    }
  },

  {
    id: "achievement", name: "Achievement", label: "Trophy Burst",
    description: "A trophy appears in a burst of light as gold stars rise — success, clearly communicated.",
    duration: 4400, color: "#fff3d0",
    build(root) {
      const burst = createRadialBurst(root, {
        duration: 4400, count: 18, color: "#fff3d0", originY: 0.4,
        icon: (ctx, size, a) => shapes.trophy(ctx, size * 2.1, "#ffd166", a)
      });
      const stars = createDriftField(root, {
        duration: 4400, count: 18, gravity: -6, sway: 8, inFrac: 0.1, outFrac: 0.35,
        spawn: (w, h) => ({
          x: rand(w * 0.08, w * 0.92), y: rand(h * 0.5, h + 60),
          vx: rand(-10, 10), vy: rand(-72, -34),
          size: rand(7, 14), rot: rand(-0.4, 0.4), vr: rand(-1, 1), t: rand(0, 10), swayFreq: rand(0.4, 0.9),
          baseAlpha: rand(0.6, 0.95), color: Math.random() < 0.6 ? "#ffd166" : "#fff3d0"
        }),
        draw: (ctx, pt, a) => shapes.star5(ctx, pt.size, pt.color, a)
      });
      return combineEffects(burst, stars);
    }
  },

  {
    id: "big-laugh", name: "Big Laugh", label: "Laughing Faces",
    description: "A burst of original laughing faces tumbles and bounces across the whole screen — playful and energetic.",
    duration: 4200, color: "#ffcf5c",
    build(root) {
      const faceColor = "#ffcf5c";
      const accentColors = ["#ff5d73", "#5fe3c2", "#8eff3d"];
      return createDriftField(root, {
        duration: 4200, count: 20, gravity: -8, sway: 14, inFrac: 0.06, outFrac: 0.3,
        spawn: (w, h) => {
          const isFace = Math.random() < 0.68;
          const edge = Math.floor(rand(0, 3));
          let x, y, vx, vy;
          if (edge === 0) { x = rand(w * 0.08, w * 0.92); y = h + rand(20, 100); vx = rand(-34, 34); vy = rand(-150, -95); }
          else if (edge === 1) { x = -rand(20, 90); y = rand(h * 0.28, h * 0.92); vx = rand(65, 130); vy = rand(-70, -10); }
          else { x = w + rand(20, 90); y = rand(h * 0.28, h * 0.92); vx = -rand(65, 130); vy = rand(-70, -10); }
          return {
            x, y, vx, vy,
            size: isFace ? rand(20, 34) : rand(8, 14),
            rot: rand(0, Math.PI * 2), vr: rand(-1.6, 1.6),
            t: rand(0, 10), swayFreq: rand(0.4, 0.9),
            baseAlpha: rand(0.78, 0.98),
            color: isFace ? faceColor : accentColors[Math.floor(Math.random() * accentColors.length)],
            kind: isFace ? "face" : "burst"
          };
        },
        draw: (ctx, pt, a) => pt.kind === "face" ? shapes.laughFace(ctx, pt.size, pt.color, a) : shapes.burstStar(ctx, pt.size, pt.color, a, 7)
      });
    }
  },

  {
    id: "halloween", name: "Halloween", label: "Floating Pumpkins",
    description: "Glowing jack-o'-lanterns drift across the page in orange and deep purple — spooky, playful, and festive.",
    duration: 6200, color: "#ff8c1a",
    build(root) {
      const palette = ["#ff8c1a", "#e8720f", "#c25e12"];
      return createDriftField(root, {
        duration: 6200, count: 14, gravity: -4, sway: 9, inFrac: 0.1, outFrac: 0.32,
        spawn: (w, h) => ({
          x: rand(w * 0.04, w * 0.96), y: rand(h * 0.5, h + 100),
          vx: rand(-10, 10), vy: rand(-30, -14),
          size: rand(16, 28), rot: rand(-0.25, 0.25), vr: rand(-0.3, 0.3),
          t: rand(0, 10), swayFreq: rand(0.3, 0.6),
          baseAlpha: rand(0.75, 0.98), color: palette[Math.floor(Math.random() * palette.length)]
        }),
        draw: (ctx, pt, a) => shapes.pumpkin(ctx, pt.size, pt.color, a, "#ffd27a")
      });
    }
  }
];

export const ANIMATION_CATALOG = CATALOG.map(({ id, name, label, description, duration, color }) => ({
  id, name, label, description, duration, color
}));

const BY_ID = new Map(CATALOG.map(entry => [entry.id, entry]));

/** null/unknown/"none" all resolve to null — the caller then renders nothing
 *  and applies no theme (see theme.js, which uses this same lookup). */
export function getAnimation(id) {
  if (!id || id === "none") return null;
  const entry = BY_ID.get(id);
  if (!entry) return null; // unknown id encountered -> treated as None
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    duration: entry.duration,
    theme: entry.id, // theme.js scopes deliver-themes.css by this same id — no second catalog
    create(root) {
      if (prefersReducedMotion()) {
        return createReducedMotionFallback(root, { color: entry.color, label: entry.name });
      }
      return entry.build(root);
    }
  };
}
