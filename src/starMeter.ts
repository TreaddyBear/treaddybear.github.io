import { bandProgress, earnedStarsForRun, totalScore } from "./scoring";
import type { StarMode } from "./scoring";

// The HUD star meter. Owns its DOM (#starMeter and children) and ports the
// design mockup's animation: stars wait on the right, break off in the last
// half-increment to meet the rising fill at their milestone, bank small on the
// left, and the bar lights gold on completion. Driven each frame by update().

type ClusterOptions = {
  big?: boolean;
  bankLast?: boolean;
  glimmer?: boolean;
};

type StarMeterState = {
  earned: number;
  lastRightCount: number;
  mode: StarMode;
};

const STAR_LAYOUTS: Record<number, number[][]> = {
  1: [[50, 50]],
  2: [[50, 33], [50, 67]],
  3: [[34, 40], [66, 40], [50, 71]],
  4: [[33, 33], [67, 33], [33, 67], [67, 67]],
  5: [[29, 32], [71, 32], [50, 52], [31, 74], [69, 74]],
};

// Where a star sits, just past the bar, before it slides in.
const CLUSTER_FRAC = 1.08;

export function createStarMeter() {
  const meterBar = document.querySelector<HTMLDivElement>("#smBar");
  const meterFill = document.querySelector<HTMLDivElement>("#smFill");
  const activeStar = document.querySelector<HTMLDivElement>("#smActive");
  const earnedCluster = document.querySelector<HTMLDivElement>("#smEarned");
  const remainingCluster = document.querySelector<HTMLDivElement>("#smRemaining");

  if(!meterBar || !meterFill || !activeStar || !earnedCluster || !remainingCluster) {
    return { update() {}, reset() {} };
  }

  const starMeterState: StarMeterState = {
    earned: 0,
    lastRightCount: -1,
    mode: 3,
  };

  const shapeStars = (
    cluster: HTMLDivElement,
    count: number,
    options: ClusterOptions = {},
  ) => {
    cluster.innerHTML = "";

    if(count <= 0) {
      return;
    }

    const starPositions = STAR_LAYOUTS[count] || STAR_LAYOUTS[5];

    starPositions.forEach((position, index) => {
      const star = document.createElement("div");
      star.className = "sm-st";
      star.textContent = "\u2605";
      star.style.left = `${position[0]}%`;
      star.style.top = `${position[1]}%`;

      if(options.big && count === 1) {
        star.classList.add("sm-big");
      }

      if(options.bankLast && index === count - 1) {
        star.classList.add("sm-bankin");
      }

      cluster.appendChild(star);
    });

    if(options.glimmer) {
      cluster.classList.remove("sm-glimmer");
      void cluster.offsetWidth;
      cluster.classList.add("sm-glimmer");
    }
  };

  const sparkle = (positionFraction: number) => {
    const barRect = meterBar.getBoundingClientRect();
    const centerX = barRect.width * Math.min(1, positionFraction);
    const centerY = barRect.height / 2;

    for(let index = 0; index < 12; index += 1) {
      const particle = document.createElement("div");
      particle.className = "sm-spark";
      particle.style.left = `${centerX}px`;
      particle.style.top = `${centerY}px`;
      meterBar.appendChild(particle);

      const angle = Math.random() * Math.PI * 2;
      const distance = 12 + (Math.random() * 22);
      const offsetX = Math.cos(angle) * distance;
      const offsetY = (Math.sin(angle) * distance) - 6;

      particle.animate(
        [
          { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
          {
            transform: `translate(${offsetX - 50}%,${offsetY}px) scale(.3)`,
            opacity: 0,
          },
        ],
        {
          duration: 420 + (Math.random() * 220),
          easing: "cubic-bezier(.2,.8,.3,1)",
        },
      );
      setTimeout(() => particle.remove(), 680);
    }
  };

  const clearCompletionStars = () => {
    meterBar.querySelectorAll(".sm-cstar").forEach((node) => node.remove());
  };

  const showComplete = () => {
    meterFill.style.width = "100%";
    meterFill.classList.add("sm-complete");
    activeStar.style.display = "none";
    earnedCluster.innerHTML = "";
    remainingCluster.innerHTML = "";

    if(meterBar.querySelector(".sm-cstar")) {
      return;
    }

    for(let index = 1; index <= starMeterState.mode; index += 1) {
      const star = document.createElement("div");
      star.className = "sm-cstar";
      star.textContent = "\u2605";
      star.style.left = `${(index / starMeterState.mode) * 100}%`;

      if(index === starMeterState.mode) {
        star.classList.add("sm-big");
      }

      star.style.animationDelay = `${index * 0.09}s, ${index * 0.09}s`;
      meterBar.appendChild(star);
    }
  };

  const render = (score: number, bankNewStar: boolean) => {
    if(starMeterState.earned >= starMeterState.mode) {
      showComplete();
      return;
    }

    meterFill.classList.remove("sm-complete");
    clearCompletionStars();

    const nextStar = starMeterState.earned + 1;
    const milestone = nextStar / starMeterState.mode;
    const increment = 1 / starMeterState.mode;
    const breakoff = milestone - (increment / 2);
    const isFinalStar = nextStar === starMeterState.mode;
    const fillFraction = (
      (starMeterState.earned / starMeterState.mode)
      + (bandProgress(score, starMeterState.earned, starMeterState.mode) * increment)
    );

    meterFill.style.width = `${(fillFraction * 100).toFixed(1)}%`;

    const brokenOff = !isFinalStar && fillFraction >= breakoff;

    if(brokenOff) {
      const slideAmount = Math.min(1, (fillFraction - breakoff) / (milestone - breakoff));
      const starX = CLUSTER_FRAC + ((milestone - CLUSTER_FRAC) * slideAmount);
      activeStar.style.display = "";
      activeStar.style.left = `${starX * 100}%`;
      activeStar.classList.toggle("sm-reaching", slideAmount < 0.92);
    } else {
      activeStar.style.display = "none";
    }

    const rightCount = (starMeterState.mode - starMeterState.earned) - (brokenOff ? 1 : 0);

    if(rightCount !== starMeterState.lastRightCount) {
      shapeStars(remainingCluster, rightCount, {
        big: true,
        glimmer: rightCount < starMeterState.lastRightCount,
      });
      starMeterState.lastRightCount = rightCount;
    }

    shapeStars(earnedCluster, starMeterState.earned, { bankLast: bankNewStar });
  };

  return {
    reset() {
      starMeterState.earned = 0;
      starMeterState.lastRightCount = starMeterState.mode;
      meterFill.classList.remove("sm-complete");
      meterFill.style.width = "0%";
      activeStar.style.display = "none";
      clearCompletionStars();
      earnedCluster.innerHTML = "";
      shapeStars(remainingCluster, starMeterState.mode, { big: true });
    },

    update(
      grassPercent: number,
      elapsedSeconds: number,
      mistakeCount: number,
      starMode: StarMode,
    ) {
      if(starMode !== starMeterState.mode) {
        starMeterState.mode = starMode;
        starMeterState.lastRightCount = -1;
      }

      const score = totalScore(grassPercent, elapsedSeconds, mistakeCount);
      const target = earnedStarsForRun(
        grassPercent,
        elapsedSeconds,
        mistakeCount,
        starMeterState.mode,
      );
      let bankedStar = false;

      while(starMeterState.earned < target) {
        sparkle((starMeterState.earned + 1) / starMeterState.mode);
        starMeterState.earned += 1;
        starMeterState.lastRightCount = -1;
        bankedStar = true;
      }

      render(score, bankedStar);
    },
  };
}
