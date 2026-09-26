// Boztik Deliver — Premium Delivery Animations catalog.
//
// This is the single source of truth for which animations exist and
// what each looks like. The Command Centre builds its <select> options
// from ANIMATION_CATALOG (see dashboard.js buildAnimationOptions()) —
// the list is never hand-duplicated in HTML. The public delivery page
// and the Command Centre's own Preview both call getAnimation(id) and
// run the exact same .create(root), so "Preview" is never a fake demo.
//
// IMPORTANT: the id strings below must exactly mirror
// deliver/worker-api/src/lib/validate.ts's ANIMATION_IDS — that file is
// the server-side allow-list. Adding an animation means adding it in
// BOTH places; nowhere else.
import {
  createDriftField, createFireworks, createDoveFlight, createRadialBurst,
  createLightSweep, createSnowfall, createReducedMotionFallback,
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
    description: "Two or three dove silhouettes cross the upper page and fade — quiet and respectful.",
    duration: 5600, color: "#c9d4e2",
    build(root) {
      return createDoveFlight(root, {
        duration: 5600,
        birds(w, h) {
          const baseY = h * 0.16;
          return [0, 1, 2].map(i => {
            const dir = i % 2 === 0 ? 1 : -1;
            const y0 = baseY + i * h * 0.055;
            const startX = dir === 1 ? -80 : w + 80;
            const endX = dir === 1 ? w + 80 : -80;
            return {
              size: 15 + i * 2, delay: i * 420, span: 3600 + i * 280,
              color: "#dfe6ee", phase: i * 1.7,
              path: t => ({
                x: startX + (endX - startX) * t,
                y: y0 + Math.sin(t * Math.PI) * -26 + Math.sin(t * 9) * 3,
                angle: dir === 1 ? 0.05 : Math.PI + 0.05
              })
            };
          });
        }
      });
    }
  },

  {
    id: "congratulations", name: "Congratulations", label: "Celebration Fireworks",
    description: "A handful of restrained fireworks launch and fade above the delivery.",
    duration: 5000, color: "#8eff3d",
    build(root) {
      return createFireworks(root, {
        duration: 5000,
        launches: (w, h) => [
          { x: w * 0.28, y: h * 0.32, delayMs: 0, color: "#8eff3d", count: 30 },
          { x: w * 0.7, y: h * 0.24, delayMs: 650, color: "#ffd166", count: 26 },
          { x: w * 0.48, y: h * 0.3, delayMs: 1300, color: "#5fe3c2", count: 32 }
        ]
      });
    }
  },

  {
    id: "birthday", name: "Birthday", label: "Floating Celebration",
    description: "Custom SVG-style balloons drift upward with a few small confetti flecks.",
    duration: 5000, color: "#ffd166",
    build(root) {
      const palette = ["#ff7b7b", "#5fe3c2", "#ffd166", "#a78bfa", "#8eff3d"];
      return createDriftField(root, {
        duration: 5000, count: 12, gravity: -4, sway: 9, inFrac: 0.1, outFrac: 0.3,
        spawn: (w, h) => {
          const isBalloon = Math.random() < 0.6;
          return {
            x: rand(w * 0.08, w * 0.92), y: rand(h * 0.5, h + 120),
            vx: rand(-6, 6), vy: rand(-40, -22),
            size: isBalloon ? rand(16, 24) : rand(3, 5),
            rot: rand(-0.15, 0.15), vr: isBalloon ? rand(-0.15, 0.15) : rand(-2, 2),
            t: rand(0, 10), swayFreq: rand(0.4, 0.8),
            baseAlpha: rand(0.7, 0.95), color: palette[Math.floor(Math.random() * palette.length)],
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
    id: "anniversary", name: "Anniversary", label: "Warm Light",
    description: "Soft warm bokeh and a few translucent heart glyphs drift up the page edges.",
    duration: 5000, color: "#f2b880",
    build(root) {
      const palette = ["#f2b880", "#f0d38a", "#e79bb0"];
      return createDriftField(root, {
        duration: 5000, count: 22, gravity: -3, sway: 6, inFrac: 0.12, outFrac: 0.32,
        spawn: (w, h) => {
          const isHeart = Math.random() < 0.22;
          return {
            x: rand(0, w) * (Math.random() < 0.5 ? 0.28 : 1) + (Math.random() < 0.5 ? 0 : w * 0.0),
            y: rand(h * 0.6, h + 60),
            vx: rand(-5, 5), vy: rand(-26, -14),
            size: isHeart ? rand(8, 12) : rand(5, 16),
            rot: 0, vr: 0, t: rand(0, 10), swayFreq: rand(0.3, 0.7),
            baseAlpha: rand(0.35, 0.7), color: palette[Math.floor(Math.random() * palette.length)],
            kind: isHeart ? "heart" : "dot"
          };
        },
        draw: (ctx, pt, a) => pt.kind === "heart" ? shapes.heart(ctx, pt.size, pt.color, a * 0.8) : shapes.softDot(ctx, pt.size, pt.color, a)
      });
    }
  },

  {
    id: "thank-you", name: "Thank You", label: "Golden Appreciation",
    description: "A warm golden light sweep crosses the page, followed by a few soft glints.",
    duration: 4000, color: "#ffcf6b",
    build(root) {
      return createLightSweep(root, {
        duration: 2200, color: "#ffcf6b", bandWidth: "34%", angle: "10deg",
        sparkles: { ...risingShape({ shape: "softDot", colors: ["#ffcf6b", "#fff3d0"], count: 14, duration: 4000, sizeMin: 3, sizeMax: 6 }) }
      });
    }
  },

  {
    id: "wedding", name: "Wedding", label: "Elegant Petals",
    description: "Restrained falling petals in blush and ivory, rotating gently as they fall.",
    duration: 5200, color: "#f3d7de",
    build(root) {
      return createDriftField(root, fallingShape({
        shape: "petal", colors: ["#f3d7de", "#fbeee2", "#e8c7cf"], count: 20,
        duration: 5200, gravity: 26, sway: 12, sizeMin: 8, sizeMax: 13
      }));
    }
  },

  {
    id: "new-baby", name: "New Baby", label: "Soft Stars",
    description: "Tiny gender-neutral stars and light particles drift softly upward.",
    duration: 4500, color: "#c9e8d6",
    build(root) {
      const palette = ["#fdf1c7", "#c9e8d6", "#d8d3f0"];
      return createDriftField(root, risingShape({
        shape: "spark", colors: palette, count: 24, duration: 4500, sizeMin: 4, sizeMax: 7
      }));
    }
  },

  {
    id: "graduation", name: "Graduation", label: "Achievement Burst",
    description: "A focused light burst with a small graduation-cap silhouette resolves into rising particles.",
    duration: 4000, color: "#ffd166",
    build(root) {
      return createRadialBurst(root, {
        duration: 4000, count: 22, color: "#ffd166", originY: 0.4,
        icon: (ctx, size, a) => shapes.capSilhouette(ctx, size, "#ffd166", a)
      });
    }
  },

  {
    id: "good-luck", name: "Good Luck", label: "Lucky Glow",
    description: "A soft green-and-gold glow with a light upward drift of particles.",
    duration: 4000, color: "#8eff3d",
    build(root) {
      const palette = ["#8eff3d", "#ffd166"];
      return createDriftField(root, {
        duration: 4000, count: 20, gravity: -5, sway: 7, inFrac: 0.12, outFrac: 0.32,
        spawn: (w, h) => {
          const glow = Math.random() < 0.18;
          return {
            x: rand(0, w), y: rand(h * 0.6, h + 60),
            vx: rand(-6, 6), vy: rand(-34, -16),
            size: glow ? rand(30, 46) : rand(4, 8),
            rot: 0, vr: 0, t: rand(0, 10), swayFreq: rand(0.3, 0.7),
            baseAlpha: glow ? rand(0.12, 0.2) : rand(0.55, 0.9),
            color: palette[Math.floor(Math.random() * palette.length)], kind: glow ? "glow" : "spark"
          };
        },
        draw: (ctx, pt, a) => pt.kind === "glow" ? shapes.softDot(ctx, pt.size, pt.color, a) : shapes.spark(ctx, pt.size, pt.color, a)
      });
    }
  },

  {
    id: "get-well", name: "Get Well Soon", label: "Gentle Spring",
    description: "Soft floating petals and light particles in calm, non-medical colours.",
    duration: 4500, color: "#bfe3c9",
    build(root) {
      const palette = ["#bfe3c9", "#f4d9df", "#eaf0dc"];
      return createDriftField(root, risingShape({
        shape: "petal", colors: palette, count: 18, duration: 4500, sizeMin: 7, sizeMax: 11
      }));
    }
  },

  {
    id: "christmas", name: "Merry Christmas", label: "Elegant Snow",
    description: "Three-layer premium snowfall with depth blur — never covers the whole screen.",
    duration: 6000, color: "#eef6ff",
    build(root) {
      return createSnowfall(root, {
        duration: 6000, color: "#eef6ff",
        layers: [
          { count: 26, speed: 20, sway: 0.6, size: 6.5, alpha: 0.5, blur: 0.8 },
          { count: 22, speed: 36, sway: 1, size: 5, alpha: 0.72, blur: 0 },
          { count: 16, speed: 55, sway: 1.4, size: 4, alpha: 0.95, blur: 0 }
        ]
      });
    }
  },

  {
    id: "new-year", name: "Happy New Year", label: "Midnight Celebration",
    description: "Sophisticated midnight fireworks in cool blues, silver and gold.",
    duration: 5500, color: "#8fb8ff",
    build(root) {
      return createFireworks(root, {
        duration: 5500,
        launches: (w, h) => [
          { x: w * 0.24, y: h * 0.3, delayMs: 0, color: "#8fb8ff", count: 28 },
          { x: w * 0.75, y: h * 0.22, delayMs: 550, color: "#f4f4f4", count: 24 },
          { x: w * 0.5, y: h * 0.34, delayMs: 1150, color: "#ffd166", count: 30 },
          { x: w * 0.35, y: h * 0.26, delayMs: 1800, color: "#8fb8ff", count: 22 }
        ]
      });
    }
  },

  {
    id: "welcome", name: "Welcome", label: "Light Reveal",
    description: "A single soft light sweep — the simplest, most elegant animation in the set.",
    duration: 2000, color: "#8eff3d",
    build(root) {
      return createLightSweep(root, { duration: 2000, color: "#8eff3d", bandWidth: "30%", angle: "6deg" });
    }
  },

  {
    id: "best-wishes", name: "Best Wishes", label: "Shimmer",
    description: "A gentle shimmer wave through the upper page, followed by a few tiny particles.",
    duration: 3200, color: "#dfe8ff",
    build(root) {
      return createLightSweep(root, {
        duration: 1800, color: "#dfe8ff", bandWidth: "26%", angle: "4deg",
        sparkles: { ...risingShape({ shape: "softDot", colors: ["#dfe8ff"], count: 8, duration: 3200, sizeMin: 2, sizeMax: 4 }) }
      });
    }
  },

  {
    id: "with-love", name: "With Love", label: "Warm Hearts",
    description: "Abstract, translucent glowing hearts drift slowly upward at varied depth.",
    duration: 4500, color: "#f0a8bb",
    build(root) {
      const palette = ["#f0a8bb", "#f5c9a1"];
      return createDriftField(root, {
        duration: 4500, count: 16, gravity: -3, sway: 5, inFrac: 0.14, outFrac: 0.34,
        spawn: (w, h) => {
          const size = rand(7, 16);
          return {
            x: rand(w * 0.05, w * 0.95), y: rand(h * 0.55, h + 60),
            vx: rand(-4, 4), vy: rand(-(10 + size), -(6 + size * 0.6)),
            size, rot: 0, vr: 0, t: rand(0, 10), swayFreq: rand(0.3, 0.6),
            baseAlpha: 0.35 + (size / 16) * 0.35, color: palette[Math.floor(Math.random() * palette.length)]
          };
        },
        draw: (ctx, pt, a) => shapes.heart(ctx, pt.size, pt.color, a)
      });
    }
  },

  {
    id: "farewell", name: "Farewell", label: "Falling Leaves",
    description: "Elegant drifting autumn leaves with natural rotation and gentle wind.",
    duration: 5200, color: "#c98a4b",
    build(root) {
      return createDriftField(root, fallingShape({
        shape: "leaf", colors: ["#c98a4b", "#b56a3a", "#8a9a4e"], count: 16,
        duration: 5200, gravity: 22, sway: 16, sizeMin: 9, sizeMax: 14
      }));
    }
  },

  {
    id: "achievement", name: "Achievement", label: "Light Burst",
    description: "A focused light burst expands and resolves into a few rising particles.",
    duration: 4000, color: "#fff3d0",
    build(root) {
      return createRadialBurst(root, { duration: 4000, count: 20, color: "#fff3d0", originY: 0.4 });
    }
  },

  {
    id: "big-laugh", name: "Big Laugh", label: "Comic Burst",
    description: "A punchy comic-style starburst pops and resolves into a quick scatter of particles — playful, fast, and fun for lighter edits.",
    duration: 3400, color: "#ffb238",
    build(root) {
      return createRadialBurst(root, {
        duration: 3400, count: 26, color: "#ffb238", originY: 0.42,
        icon: (ctx, size, a) => shapes.burstStar(ctx, size * 1.35, "#ff5d73", a, 9)
      });
    }
  }
];

export const ANIMATION_CATALOG = CATALOG.map(({ id, name, label, description, duration, color }) => ({
  id, name, label, description, duration, color
}));

const BY_ID = new Map(CATALOG.map(entry => [entry.id, entry]));

/** null/unknown/"none" all resolve to null — the caller then renders nothing. */
export function getAnimation(id) {
  if (!id || id === "none") return null;
  const entry = BY_ID.get(id);
  if (!entry) return null; // unknown id encountered -> treated as None (see client controller)
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    duration: entry.duration,
    create(root) {
      if (prefersReducedMotion()) {
        return createReducedMotionFallback(root, { color: entry.color, label: entry.name });
      }
      return entry.build(root);
    }
  };
}
