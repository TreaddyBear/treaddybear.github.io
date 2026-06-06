import { bandProgress, earnedStars, totalScore } from "./scoring";
import type { StarMode } from "./scoring";

// The HUD star meter. Owns its DOM (#starMeter and children) and ports the
// design mockup's animation: stars wait on the right, break off in the last
// half-increment to meet the rising fill at their milestone, bank small on the
// left, and the bar lights gold on completion. Driven each frame by update().

type ClusterOpts = { big?: boolean; bankLast?: boolean; glimmer?: boolean };

const SHAPES: Record<number, number[][]> = {
  1: [[50, 50]],
  2: [[50, 33], [50, 67]],
  3: [[34, 40], [66, 40], [50, 71]],
  4: [[33, 33], [67, 33], [33, 67], [67, 67]],
  5: [[29, 32], [71, 32], [50, 52], [31, 74], [69, 74]],
};
const CLUSTER_FRAC = 1.08; // where a star sits (just past the bar) before it slides in

export function createStarMeter() {
  const bar = document.querySelector<HTMLDivElement>("#smBar");
  const fill = document.querySelector<HTMLDivElement>("#smFill");
  const active = document.querySelector<HTMLDivElement>("#smActive");
  const earnedEl = document.querySelector<HTMLDivElement>("#smEarned");
  const remainingEl = document.querySelector<HTMLDivElement>("#smRemaining");

  if (!bar || !fill || !active || !earnedEl || !remainingEl) {
    return { update() {}, reset() {} };
  }

  let earned = 0;
  let lastRight = -1;
  let mode: StarMode = 3;

  const shapeStars = (el: HTMLDivElement, count: number, opts: ClusterOpts = {}) => {
    el.innerHTML = "";
    if (count <= 0) {
      return;
    }
    const pts = SHAPES[count] || SHAPES[5];
    pts.forEach((p, i) => {
      const s = document.createElement("div");
      s.className = "sm-st";
      s.textContent = "★";
      s.style.left = `${p[0]}%`;
      s.style.top = `${p[1]}%`;
      if (opts.big && count === 1) {
        s.classList.add("sm-big");
      }
      if (opts.bankLast && i === count - 1) {
        s.classList.add("sm-bankin");
      }
      el.appendChild(s);
    });
    if (opts.glimmer) {
      el.classList.remove("sm-glimmer");
      void el.offsetWidth;
      el.classList.add("sm-glimmer");
    }
  };

  const sparkle = (xFrac: number) => {
    const rect = bar.getBoundingClientRect();
    const cx = rect.width * Math.min(1, xFrac);
    const cy = rect.height / 2;
    for (let i = 0; i < 12; i += 1) {
      const p = document.createElement("div");
      p.className = "sm-spark";
      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      bar.appendChild(p);
      const ang = Math.random() * Math.PI * 2;
      const d = 12 + (Math.random() * 22);
      const dx = Math.cos(ang) * d;
      const dy = (Math.sin(ang) * d) - 6;
      p.animate(
        [{ transform: "translate(-50%,-50%) scale(1)", opacity: 1 }, { transform: `translate(${dx - 50}%,${dy}px) scale(.3)`, opacity: 0 }],
        { duration: 420 + (Math.random() * 220), easing: "cubic-bezier(.2,.8,.3,1)" },
      );
      setTimeout(() => p.remove(), 680);
    }
  };

  const clearCStars = () => bar.querySelectorAll(".sm-cstar").forEach((n) => n.remove());

  const showComplete = () => {
    fill.style.width = "100%";
    fill.classList.add("sm-complete");
    active.style.display = "none";
    earnedEl.innerHTML = "";
    remainingEl.innerHTML = "";
    if (bar.querySelector(".sm-cstar")) {
      return; // already showing the completion stars; don't re-spawn every frame
    }
    for (let i = 1; i <= mode; i += 1) {
      const s = document.createElement("div");
      s.className = "sm-cstar";
      s.textContent = "★";
      s.style.left = `${(i / mode) * 100}%`;
      if (i === mode) {
        s.classList.add("sm-big");
      }
      s.style.animationDelay = `${i * 0.09}s, ${i * 0.09}s`;
      bar.appendChild(s);
    }
  };

  const render = (score: number, bankNew: boolean) => {
    if (earned >= mode) {
      showComplete();
      return;
    }
    fill.classList.remove("sm-complete");
    clearCStars();

    const star = earned + 1;
    const milestone = star / mode;
    const increment = 1 / mode;
    const breakoff = milestone - (increment / 2);
    const isFinal = star === mode;
    const fillFrac = (earned / mode) + (bandProgress(score, earned, mode) * increment);
    fill.style.width = `${(fillFrac * 100).toFixed(1)}%`;

    const brokenOff = !isFinal && fillFrac >= breakoff;
    if (brokenOff) {
      const slideT = Math.min(1, (fillFrac - breakoff) / (milestone - breakoff));
      const x = CLUSTER_FRAC + ((milestone - CLUSTER_FRAC) * slideT);
      active.style.display = "";
      active.style.left = `${x * 100}%`;
      active.classList.toggle("sm-reaching", slideT < 0.92);
    } else {
      active.style.display = "none";
    }

    const rightCount = (mode - earned) - (brokenOff ? 1 : 0);
    if (rightCount !== lastRight) {
      shapeStars(remainingEl, rightCount, { big: true, glimmer: rightCount < lastRight });
      lastRight = rightCount;
    }
    shapeStars(earnedEl, earned, { bankLast: bankNew });
  };

  return {
    reset() {
      earned = 0;
      lastRight = mode;
      fill.classList.remove("sm-complete");
      fill.style.width = "0%";
      active.style.display = "none";
      clearCStars();
      earnedEl.innerHTML = "";
      shapeStars(remainingEl, mode, { big: true });
    },

    update(grassPercent: number, elapsedSeconds: number, mistakeCount: number, starMode: StarMode) {
      if (starMode !== mode) {
        mode = starMode;
        lastRight = -1;
      }
      const score = totalScore(grassPercent, elapsedSeconds, mistakeCount);
      const target = earnedStars(score, mode); // stars are permanent, so only ever climb
      let banked = false;
      while (earned < target) {
        sparkle((earned + 1) / mode);
        earned += 1;
        lastRight = -1;
        banked = true;
      }
      render(score, banked);
    },
  };
}
