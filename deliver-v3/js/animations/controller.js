// Boztik Deliver — wires the animation registry to the public delivery
// page: plays the delivery's chosen animation exactly once per page
// load, then offers a small, optional replay control. Never used by
// the Command Centre preview (see dashboard.js), which calls
// getAnimation() directly so Preview always runs the exact production
// implementation without this page's one-play lifecycle rule.
import { getAnimation } from "./registry.js";

/**
 * @param {HTMLElement} layer  the fixed, aria-hidden, pointer-events:none
 *   container animations render into.
 * @param {HTMLElement|null} replayButton  optional small control shown
 *   once the first play completes.
 */
export function createDeliveryAnimationController(layer, replayButton) {
  let current = null;
  let armed = false; // guards against a second start() in the same page load

  function stop() {
    try { current?.destroy(); } catch (e) { console.error("[Boztik Deliver] Animation teardown failed:", e); }
    current = null;
  }

  function runOnce(animation) {
    stop();
    if (replayButton) { replayButton.hidden = true; }
    try {
      current = animation.create(layer);
      current.play();
    } catch (e) {
      // Section 25: an animation failure must never affect the delivery itself.
      console.error("[Boztik Deliver] Animation failed to play:", e);
      current = null;
      return;
    }
    // Once naturally finished, tear the instance all the way down (removes
    // the canvas/DOM node, not just its pixels) — no permanent render
    // surface sits idle in the layer between completion and a replay.
    const finish = () => {
      stop();
      if (replayButton) replayButton.hidden = false;
    };
    setTimeout(finish, Math.max(600, animation.duration) + 150);
  }

  return {
    /** Starts the delivery's chosen animation. Safe to call with any
     *  value — null, "none", or an id the current registry no longer
     *  recognises all resolve to a silent no-op. */
    start(animationId) {
      if (armed) return;
      const animation = getAnimation(animationId);
      if (!animation) return;
      armed = true;

      runOnce(animation);
      if (replayButton) {
        replayButton.addEventListener("click", () => runOnce(animation));
        replayButton.setAttribute("aria-label", `Replay the ${animation.name} animation`);
      }
    },
    destroy() { stop(); }
  };
}
