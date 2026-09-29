// Boztik Deliver — persistent occasion theme.
//
// Deliberately separate from controller.js: the animation canvas is
// transient (plays once, tears itself down), but the selected occasion's
// page styling must remain for the whole viewing session. This module
// owns exactly one thing — applying (and never removing) a
// `data-deliver-theme` attribute on <body> — and is never called from
// the animation controller's stop()/destroy()/replay path.
//
// Validated through the same getAnimation() lookup the animation system
// uses, so there is never a second occasion list that can drift out of
// sync with registry.js. Unknown/missing/"none" ids apply nothing and
// leave the default Boztik delivery page exactly as it is today.
import { getAnimation } from "./registry.js";

let applied = false;

/**
 * @param {string|null|undefined} animationId  the same id read from the
 *   `?anim=` URL parameter that the animation controller receives.
 */
export function applyDeliveryTheme(animationId) {
  if (applied) return; // one deliberate application per page load, same as the animation
  const animation = getAnimation(animationId);
  if (!animation) return; // none / unknown -> default page, untouched
  document.body.dataset.deliverTheme = animation.theme;
  applied = true;
}
