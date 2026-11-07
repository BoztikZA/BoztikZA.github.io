// Boztik Deliver Experience 2.0
// Local-only click reactions. The selected effect runs once on the first
// download interaction; animation/audio failures never affect file delivery.
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
  "best-wishes": { style: "reveal", title: "WITH BEST WISHES", message: "A little brightness for what comes next." }
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
      gain.gain.exponentialRampToValueAtTime(0.075, now + offset + 0.025);
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

export function createDeliveryReactionController(layer, animationId, options = {}) {
  const id = String(animationId || "").trim().toLowerCase();
  const reaction = REACTIONS[id] || null;
  const animation = getAnimation(id);
  const soundEnabled = options.soundEnabled === true;
  let played = false;
  let activeAnimation = null;
  let cleanupTimer = 0;

  function play(button) {
    if (played) return false;
    played = true;

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
      window.setTimeout(() => caption.classList.add("is-visible"), 30);
      window.setTimeout(() => caption.classList.add("is-leaving"), 2050);
      window.setTimeout(() => caption.remove(), 2700);
    }

    if (animation && layer) {
      try {
        activeAnimation = animation.create(layer);
        activeAnimation.play();
        cleanupTimer = window.setTimeout(() => {
          try { activeAnimation?.destroy(); } catch (error) {
            console.error("[Boztik Deliver] Reaction cleanup failed:", error);
          }
          activeAnimation = null;
        }, Math.max(700, animation.duration) + 180);
      } catch (error) {
        console.error("[Boztik Deliver] Visual reaction failed:", error);
        activeAnimation = null;
      }
    }

    if (soundEnabled) playLocalSound(id);
    return true;
  }

  return {
    play,
    destroy() {
      window.clearTimeout(cleanupTimer);
      try { activeAnimation?.destroy(); } catch {}
      activeAnimation = null;
    }
  };
}
