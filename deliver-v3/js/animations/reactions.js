// Boztik Deliver Experience 2.0
// Original, locally hosted click reactions. No third-party animation or audio requests.
import { getAnimation } from "./registry.js";

const REACTIONS = {
  "big-laugh": { style: "runaway", title: "TOO SLOW!", message: "Just kidding. Your download is ready." },
  halloween: { style: "haunted", title: "SOMETHING'S HERE…", message: "Your file is ready. If you dare." },
  congratulations: { style: "celebrate", title: "YOU DID IT!", message: "A little celebration for a brilliant result." },
  birthday: { style: "birthday", title: "MAKE A WISH!", message: "Your birthday surprise is ready." },
  wedding: { style: "romance", title: "MADE FOR EACH OTHER", message: "Wishing you a lifetime of beautiful moments." },
  anniversary: { style: "romance", title: "ANOTHER CHAPTER TOGETHER", message: "Here's to everything still to come." },
  "with-love": { style: "romance", title: "SENT WITH LOVE", message: "A little something from the heart." },
  achievement: { style: "achievement", title: "WELL EARNED", message: "Take a moment. You deserve it." },
  graduation: { style: "achievement", title: "THE NEXT CHAPTER", message: "Congratulations on reaching this milestone." },
  "thank-you": { style: "gratitude", title: "THANK YOU", message: "Your support and trust mean a lot." },
  welcome: { style: "reveal", title: "WELCOME", message: "Your files are ready when you are." },
  "best-wishes": { style: "reveal", title: "WITH BEST WISHES", message: "A little brightness for what comes next." },
  condolences: { style: "gratitude", title: "WITH SYMPATHY", message: "Thinking of you and sending comfort." },
  "new-baby": { style: "birthday", title: "A LITTLE MIRACLE", message: "Wishing your family a lifetime of love." },
  "good-luck": { style: "reveal", title: "YOU HAVE THIS", message: "Wishing you confidence and good fortune." },
  "get-well": { style: "gratitude", title: "SENDING GOOD THOUGHTS", message: "Wishing you comfort and a smooth recovery." },
  christmas: { style: "celebrate", title: "SEASON'S GREETINGS", message: "Wishing you warmth, joy and a little magic." },
  "new-year": { style: "celebrate", title: "A FRESH BEGINNING", message: "Here's to new possibilities." },
  farewell: { style: "reveal", title: "UNTIL NEXT TIME", message: "Wishing you the very best in what comes next." }
};

const PALETTES = {
  "big-laugh": ["#a5ff57", "#f7fff0", "#6ee7b7"],
  halloween: ["#a855f7", "#7c3aed", "#d8b4fe", "#68717f"],
  congratulations: ["#ffe3a1", "#f6bd60", "#fff8df", "#d99b35"],
  birthday: ["#ffcf70", "#ff7fa7", "#7ee7d4", "#b7a2ff", "#fff0ad"],
  wedding: ["#f5d8a4", "#fff1d2", "#d8a6b6", "#fffaf0"],
  anniversary: ["#f5d8a4", "#fff1d2", "#d8a6b6"],
  "with-love": ["#ffc4d7", "#f5d8a4", "#fff1d2"],
  achievement: ["#ffe3a1", "#f6bd60", "#fff8df"],
  graduation: ["#ffe3a1", "#f6bd60", "#fff8df"],
  "thank-you": ["#a5ff57", "#d7f8c2", "#fff"],
  welcome: ["#a5ff57", "#d7f8c2", "#fff"],
  "best-wishes": ["#a5ff57", "#d7f8c2", "#fff"]
};

function playLocalSound(id) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  let context;
  try {
    context = new AudioContext();
    const now = context.currentTime;
    const presets = {
      "big-laugh": [[520, 250, 0.22], [360, 170, 0.34]],
      halloween: [[110, 70, 0.85], [440, 120, 0.62]],
      congratulations: [[660, 110, 0.15], [880, 110, 0.31], [1174, 90, 0.48]],
      birthday: [[523, 100, 0.12], [659, 100, 0.25], [784, 100, 0.38], [1046, 100, 0.52]],
      wedding: [[659, 180, 0.12], [880, 180, 0.3], [1318, 240, 0.48]],
      anniversary: [[587, 180, 0.12], [784, 180, 0.3], [1174, 240, 0.48]],
      "with-love": [[523, 220, 0.12], [659, 220, 0.32]],
      achievement: [[392, 100, 0.1], [587, 100, 0.24], [784, 230, 0.4]],
      graduation: [[523, 110, 0.1], [659, 110, 0.24], [784, 240, 0.4]],
      "thank-you": [[587, 180, 0.1], [784, 260, 0.3]],
      welcome: [[440, 160, 0.1], [660, 220, 0.28]],
      "best-wishes": [[523, 200, 0.1], [784, 260, 0.3]]
    };
    const notes = presets[id] || [[523, 150, 0.1], [784, 190, 0.28]];
    notes.forEach(([frequency, duration, offset]) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now + offset);
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(2400, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.065, now + offset + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration / 1000);
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + duration / 1000 + 0.04);
    });
    window.setTimeout(() => context.close().catch(() => {}), 1600);
  } catch (error) {
    try { context?.close(); } catch {}
    console.debug("[Boztik Deliver] Optional sound unavailable:", error);
  }
}

function createCinematicCanvas(layer, button, id) {
  const canvas = document.createElement("canvas");
  canvas.className = "deliver-reaction-canvas";
  canvas.setAttribute("aria-hidden", "true");
  layer.appendChild(canvas);
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) { canvas.remove(); return { destroy() {} }; }

  const duration = id === "halloween" ? 2700 : 2250;
  const palette = PALETTES[id] || PALETTES.welcome;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  if (reduced) { canvas.remove(); return { destroy() {} }; }
  let raf = 0;
  let started = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let origin = { x: window.innerWidth / 2, y: window.innerHeight * 0.72 };
  const rect = button?.getBoundingClientRect?.();
  if (rect && rect.width && rect.height) origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize, { passive: true });

  const count = id === "halloween" ? 32 : id === "big-laugh" ? 42 : 58;
  const particles = Array.from({ length: reduced ? 0 : count }, (_, i) => {
    const angle = Math.random() * Math.PI * 2;
    const speed = id === "halloween" ? 16 + Math.random() * 38 : 65 + Math.random() * 210;
    return {
      angle,
      speed,
      radius: 1.2 + Math.random() * (id === "halloween" ? 8 : 3.8),
      spin: (Math.random() - 0.5) * 8,
      drift: (Math.random() - 0.5) * 100,
      color: palette[i % palette.length],
      shape: Math.random() > 0.5 ? "dot" : "shard",
      delay: Math.random() * 0.18
    };
  });

  function draw(time) {
    if (!started) started = time;
    const elapsed = time - started;
    const progress = Math.min(1, elapsed / duration);
    const easeOut = 1 - Math.pow(1 - progress, 2.4);
    ctx.clearRect(0, 0, width, height);

    if (id === "wedding" || id === "anniversary" || id === "with-love") {
      const ringProgress = Math.min(1, progress * 1.45);
      const radius = 22 + ringProgress * Math.min(width, height) * 0.19;
      ctx.save();
      ctx.translate(origin.x, origin.y);
      ctx.globalAlpha = (1 - progress) * 0.72;
      ctx.lineWidth = 1.7;
      ctx.shadowBlur = 20;
      ctx.shadowColor = "#f5d8a4";
      ctx.strokeStyle = "#f5d8a4";
      ctx.beginPath();
      ctx.ellipse(-radius * 0.22, 0, radius * 0.58, radius * 0.29, -0.48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(radius * 0.22, 0, radius * 0.58, radius * 0.29, 0.48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (id === "halloween") {
      for (let i = 0; i < 7; i++) {
        const drift = (elapsed * (0.012 + i * 0.002)) % 80;
        const x = origin.x + Math.sin(elapsed * 0.0007 + i * 1.9) * (45 + i * 12);
        const y = origin.y - drift - i * 13;
        const radius = 22 + i * 5;
        const gradient = ctx.createRadialGradient(x, y, 1, x, y, radius);
        gradient.addColorStop(0, "rgba(154,93,214," + ((1 - progress) * 0.12) + ")");
        gradient.addColorStop(1, "rgba(75,42,105,0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    particles.forEach(p => {
      const local = Math.max(0, Math.min(1, (progress - p.delay) / (1 - p.delay)));
      if (local <= 0) return;
      const distance = p.speed * (local * 1.7);
      let x = origin.x + Math.cos(p.angle) * distance + p.drift * local;
      let y = origin.y + Math.sin(p.angle) * distance + (id === "halloween" ? -local * 85 : local * local * 80);
      if (id === "big-laugh") {
        x += Math.sin(local * 18 + p.spin) * 24;
        y += Math.cos(local * 14 + p.spin) * 8;
      }
      const alpha = Math.max(0, (1 - local) * (id === "halloween" ? 0.6 : 0.95));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = id === "halloween" ? 14 : 11;
      if (p.shape === "shard" && id !== "halloween") {
        ctx.translate(x, y);
        ctx.rotate(local * p.spin);
        ctx.fillRect(-p.radius, -p.radius * 2.4, p.radius * 2, p.radius * 4.8);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    if (id === "big-laugh") {
      ctx.save();
      ctx.globalAlpha = (1 - progress) * 0.36;
      ctx.strokeStyle = "#b8ff83";
      ctx.lineWidth = 1;
      for (let i = 0; i < 18; i++) {
        const y = origin.y - 95 + i * 11;
        const shift = (elapsed * (0.16 + i * 0.008)) % (width + 180);
        ctx.beginPath();
        ctx.moveTo(shift - 180, y);
        ctx.lineTo(shift + 45, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (progress < 1) raf = window.requestAnimationFrame(draw);
    else destroy();
  }

  function destroy() {
    window.cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    canvas.remove();
  }

  raf = window.requestAnimationFrame(draw);
  return { destroy };
}

export function createDeliveryReactionController(layer, animationId, options = {}) {
  const id = String(animationId || "").trim().toLowerCase();
  const reaction = REACTIONS[id] || (getAnimation(id) ? { style: "reveal", title: "YOUR FILE IS READY", message: "Your Boztik delivery is ready to enjoy." } : null);
  const knownAnimation = getAnimation(id);
  const soundEnabled = options.soundEnabled === true;
  let played = false;
  let activeVisual = null;
  let captionTimer = 0;

  function play(button) {
    if (played) return false;
    played = true;
    if (!knownAnimation) return false;

    if (button && reaction) {
      button.classList.add("deliver-reaction-button", "deliver-reaction-button--" + reaction.style);
      window.setTimeout(() => {
        button.classList.remove("deliver-reaction-button", "deliver-reaction-button--" + reaction.style);
      }, 1250);
    }

    if (layer && reaction) {
      const caption = document.createElement("div");
      caption.className = "deliver-reaction-caption deliver-reaction-caption--" + reaction.style;
      caption.setAttribute("aria-live", "polite");
      const title = document.createElement("strong");
      title.textContent = reaction.title;
      const message = document.createElement("span");
      message.textContent = reaction.message;
      caption.append(title, message);
      layer.append(caption);
      const status = document.getElementById("deliver-reaction-status");
      if (status) status.textContent = reaction.title + ". " + reaction.message;
      window.setTimeout(() => caption.classList.add("is-visible"), 30);
      window.setTimeout(() => caption.classList.add("is-leaving"), 2050);
      captionTimer = window.setTimeout(() => caption.remove(), 2700);
      try {
        activeVisual = createCinematicCanvas(layer, button, id);
      } catch (error) {
        console.error("[Boztik Deliver] Cinematic effect failed:", error);
      }
    }

    if (soundEnabled) playLocalSound(id);
    return true;
  }

  return {
    play,
    destroy() {
      window.clearTimeout(captionTimer);
      try { activeVisual?.destroy(); } catch {}
      activeVisual = null;
    }
  };
}
