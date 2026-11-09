const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
const startMenu = document.getElementById("start-menu");
const overlayTitle = document.getElementById("overlay-title");
const overlayCopy = document.getElementById("overlay-copy");
const startButton = document.getElementById("start-button");
const restartButton = document.getElementById("restart-button");
const pauseButton = document.getElementById("pause-button");
const scoreLabel = document.getElementById("score");
const bestLabel = document.getElementById("best");
const livesLabel = document.getElementById("lives");
const pausedTag = document.getElementById("paused-tag");

const W = canvas.width, H = canvas.height;

// Pill physics. Values are calibrated to the original 120 Hz timing.
const FLAP_VY = -4.6, GRAVITY = 0.13, MAX_FALL = 2.2;

// Damage timing and speed recovery, measured in original 120 Hz frames.
const HIT_INVINCIBLE_FRAMES = 220;
const HIT_SLOW = 0.5;
const SPEED_RECOVERY = 0.008;

const INTRO_MS = 4000;
let best = 0;

const follicleImg = new Image();
follicleImg.src = "follicle.svg";

let pill, score, lives, running, paused, frame, damageCooldown, keys, scrollX, speedMod, introMs;
let bubble, bubbleElapsedMs, bonusPopup, scoreFrameAccumulator;

const BUBBLE_INTERVAL_MS = 7000;
const BUBBLE_RADIUS = 17;
const BUBBLE_BONUS = 100;

bestLabel.textContent = best;

function reset() {
  pill = { x: 118, y: 340, vy: 0 };
  score = 0;
  lives = 3;
  frame = 0;
  scoreFrameAccumulator = 0;
  damageCooldown = 0;
  speedMod = 1;
  introMs = INTRO_MS;
  bubble = null;
  bubbleElapsedMs = 0;
  bonusPopup = null;

  initTerrain();

  running = true;
  paused = false;

  scoreLabel.textContent = score;
  updateLives();

  overlay.classList.add("hidden");
  startMenu.style.display = "none";
  pausedTag.classList.remove("visible");
  pauseButton.textContent = "Ⅱ";
}

const HEART_PATH = "M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.7 4.5 6.4 4.5c2.1 0 3.6 1.1 5.6 3.2 2-2.1 3.5-3.2 5.6-3.2 3.7 0 5.5 3.9 4 7.3C19.5 16.4 12 21 12 21z";

function heartSvg(full) {
  return `<svg class="heart" viewBox="0 0 24 24" aria-hidden="true">` +
    `<path d="${HEART_PATH}" fill="${full ? "#ff6574" : "none"}" stroke="#ff6574" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

function updateLives() {
  let hearts = "";

  for (let i = 0; i < 3; i++) {
    hearts += heartSvg(i < lives);
  }

  livesLabel.innerHTML = hearts;
  livesLabel.setAttribute("aria-label", `${lives} lives remaining`);
}

function flap() {
  if (!running || paused) return;
  pill.vy = FLAP_VY;
}

function loseLife(side) {
  if (damageCooldown > 0) return;

  lives--;
  damageCooldown = HIT_INVINCIBLE_FRAMES;
  speedMod = HIT_SLOW;

  updateLives();

  const mid = (topEdgeAt(pill.x) + bottomEdgeAt(pill.x)) / 2;
  pill.y += (mid - pill.y) * 0.6;

  pill.vy = side === "bottom" ? -3 : 1.5;

  if (lives <= 0) finish();
}

function finish() {
  running = false;

  if (score > best) {
    best = score;
    bestLabel.textContent = best;
  }

  overlayTitle.textContent = "Threshold Crossed";
  overlayCopy.textContent = `Your score was ${score}. Try to keep the pill inside the optimal therapeutic window for longer.`;
  overlay.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Scrolling corridor
// ---------------------------------------------------------------------------

const TOP_MIN = 122;
const BOT_MAX = 545;

const SPEED_BASE = 2.3;
const SPEED_PER_POINT = 0.0035;
const DIFFICULTY_POINTS = 450;

function difficulty() {
  return Math.min(score / DIFFICULTY_POINTS, 1);
}

function baseSpeed() {
  return SPEED_BASE + score * SPEED_PER_POINT;
}

function scrollSpeed() {
  return baseSpeed() * speedMod;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mod = (n, m) => ((n % m) + m) % m;

function initTerrain() {
  scrollX = 0;

  keys = [
    { x: -120, top: 200, bottom: 475, pinch: false, passed: true },
    { x: 300, top: 200, bottom: 475, pinch: false, passed: true },
    { x: 600, top: 200, bottom: 475, pinch: false, passed: true }
  ];

  ensureTerrain();
}

const CORRIDOR = {
  openGap: [300, 265],
  pinchGap: [230, 190],
  maxSlope: [0.45, 0.40],
  segmentLen: [200, 260],
  pinchChance: [0.35, 0.65]
};

const lerpD = (pair, d) => pair[0] + (pair[1] - pair[0]) * d;

function nextKey(prev) {
  const d = difficulty();

  const length = lerpD(CORRIDOR.segmentLen, d) * (0.85 + Math.random() * 0.3);
  const slope = Math.min(lerpD(CORRIDOR.maxSlope, d), 3.0 / baseSpeed());
  const maxDelta = slope * length * 2 / Math.PI;

  const minGap = lerpD(CORRIDOR.pinchGap, d);
  const openGap = lerpD(CORRIDOR.openGap, d);

  const pinch = !prev.pinch && Math.random() < lerpD(CORRIDOR.pinchChance, d);

  const gap = pinch ? minGap + Math.random() * 10 : openGap - Math.random() * 25;

  const cMin = TOP_MIN + gap / 2;
  const cMax = BOT_MAX - gap / 2;
  const center = cMin + Math.random() * (cMax - cMin);

  let top = clamp(center - gap / 2, prev.top - maxDelta, prev.top + maxDelta);
  let bottom = clamp(center + gap / 2, prev.bottom - maxDelta, prev.bottom + maxDelta);

  if (bottom - top < minGap) {
    const mid = (top + bottom) / 2;
    top = mid - minGap / 2;
    bottom = mid + minGap / 2;
  }

  if (top < TOP_MIN) {
    bottom += TOP_MIN - top;
    top = TOP_MIN;
  }

  if (bottom > BOT_MAX) {
    top -= bottom - BOT_MAX;
    bottom = BOT_MAX;
  }

  return {
    x: prev.x + length,
    top,
    bottom,
    pinch,
    passed: false
  };
}

function ensureTerrain() {
  while (keys[keys.length - 1].x < scrollX + W + 260) {
    keys.push(nextKey(keys[keys.length - 1]));
  }

  while (keys.length > 2 && keys[1].x < scrollX - 60) {
    keys.shift();
  }
}

function terrainAt(wx) {
  if (wx <= keys[0].x) return keys[0];

  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];

    if (wx < b.x) {
      const t = (wx - a.x) / (b.x - a.x);
      const s = (1 - Math.cos(Math.PI * t)) / 2;

      return {
        top: a.top + (b.top - a.top) * s,
        bottom: a.bottom + (b.bottom - a.bottom) * s
      };
    }
  }

  return keys[keys.length - 1];
}

function topEdgeAt(sx) {
  const wx = sx + scrollX;
  return terrainAt(wx).top + Math.sin(wx * 0.05 + frame * 0.035) * 3;
}

function bottomEdgeAt(sx) {
  const wx = sx + scrollX;
  return terrainAt(wx).bottom + Math.sin(wx * 0.04 + frame * 0.03 + 1.5) * 3;
}

function drawBackground() {
  const bg = ctx.createLinearGradient(0, 0, 0, H);

  bg.addColorStop(0, "#18cbd8");
  bg.addColorStop(0.5, "#16d1d4");
  bg.addColorStop(1, "#a8f4c9");

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 42; i++) {
    const x = (i * 79 + frame * (i % 3 + 1) * 0.18) % W;
    const y = (i * 137) % H;

    ctx.fillStyle = i % 3 === 0
      ? "rgba(255,255,255,.58)"
      : "rgba(25,143,164,.22)";

    ctx.beginPath();
    ctx.arc(x, y, 1.5 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 12; i++) {
    const x = (i * 47 + 18) % W;
    const y = 180 + (i * 53) % 300;

    ctx.strokeStyle = "rgba(255,255,255,.22)";
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.moveTo(x - 9, y);
    ctx.lineTo(x + 9, y);
    ctx.moveTo(x, y - 9);
    ctx.lineTo(x, y + 9);
    ctx.stroke();
  }
}

function drawCardiacThreshold() {
  const edge = topEdgeAt;
  let maxTop = 0;

  for (let x = 0; x <= W; x += 4) {
    maxTop = Math.max(maxTop, edge(x));
  }

  ctx.beginPath();
  ctx.moveTo(0, 0);

  for (let x = 0; x <= W; x += 4) {
    ctx.lineTo(x, edge(x));
  }

  ctx.lineTo(W, 0);
  ctx.closePath();

  const red = ctx.createLinearGradient(0, 0, 0, Math.max(maxTop, 160));

  red.addColorStop(0, "#ff405c");
  red.addColorStop(1, "#e92d50");

  ctx.fillStyle = red;
  ctx.fill();

  ctx.save();
  ctx.clip();

  ctx.strokeStyle = "rgba(255,220,215,.42)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";

  for (let k = Math.floor(scrollX / 25) - 1; k * 25 - scrollX < W + 25; k++) {
    const sx = k * 25 + 12 - scrollX;
    const y = edge(sx);

    for (let row = 0; y - 30 - row * 60 > -40; row++) {
      const yy = y - row * 60;

      ctx.beginPath();
      ctx.moveTo(sx, yy - 30);
      ctx.bezierCurveTo(sx + 7, yy - 20, sx - 6, yy - 9, sx + 2, yy + 1);
      ctx.stroke();
    }
  }

  const ecgY = 56;
  const traceOffset = (frame * 1.8) % 210;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 28, W, 46);
  ctx.clip();

  ctx.beginPath();
  ctx.moveTo(-220 - traceOffset, ecgY);

  for (let x = -220 - traceOffset; x < W + 230; x += 210) {
    ctx.lineTo(x + 42, ecgY);
    ctx.lineTo(x + 55, ecgY - 7);
    ctx.lineTo(x + 68, ecgY + 8);
    ctx.lineTo(x + 82, ecgY - 29);
    ctx.lineTo(x + 96, ecgY + 15);
    ctx.lineTo(x + 111, ecgY);
    ctx.lineTo(x + 210, ecgY);
  }

  ctx.strokeStyle = "rgba(255,255,255,.88)";
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(145,20,40,.45)";
  ctx.shadowBlur = 4;
  ctx.stroke();

  ctx.restore();
  ctx.restore();

  ctx.beginPath();

  for (let x = 0; x <= W; x += 4) {
    const y = edge(x);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.strokeStyle = "#ffd0cb";
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,.93)";
  ctx.font = "800 13px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("Cardiac Activity Threshold", W / 2, 19);
}

function drawHairThreshold() {
  const edge = bottomEdgeAt;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, edge(0));

  for (let x = 0; x <= W; x += 4) {
    ctx.lineTo(x, edge(x));
  }

  ctx.lineTo(W, H - 18);
  ctx.quadraticCurveTo(W, H, W - 18, H);
  ctx.lineTo(18, H);
  ctx.quadraticCurveTo(0, H, 0, H - 18);
  ctx.closePath();
  ctx.clip();

  const layers = [
    [0, "#ffd6ad", 0],
    [8, "#ffe8c5", 2],
    [22, "#ffb78e", 2],
    [70, "#f79a78", 0],
    [130, "#ee806c", 0],
    [200, "#e56b69", 0]
  ];

  for (const [off, color, wobble] of layers) {
    ctx.beginPath();
    ctx.moveTo(0, edge(0) + off);

    for (let x = 0; x <= W; x += 4) {
      ctx.lineTo(
        x,
        edge(x) + off + Math.sin((x + scrollX) * 0.09) * wobble
      );
    }

    ctx.lineTo(W, H + 2);
    ctx.lineTo(0, H + 2);
    ctx.closePath();

    ctx.fillStyle = color;
    ctx.fill();
  }

  const shade = ctx.createLinearGradient(0, H - 44, 0, H);

  shade.addColorStop(0, "rgba(176,62,80,0)");
  shade.addColorStop(1, "rgba(176,62,80,.35)");

  ctx.fillStyle = shade;
  ctx.fillRect(0, H - 44, W, 44);

  for (let row = 0; row < 30; row++) {
    for (let k = Math.floor(scrollX / 28) - 1; k * 28 - scrollX < W + 28; k++) {
      const sx = k * 28 + (row % 2) * 13 + 4 - scrollX;
      const y = edge(sx) + 32 + row * 15 + Math.sin(k * 1.7 + row) * 2;

      if (y > H + 8) continue;

      const r = 4 + mod(k, 3) * 0.7;

      ctx.fillStyle = row % 2
        ? "rgba(255,190,174,.19)"
        : "rgba(145,54,66,.10)";

      ctx.beginPath();
      ctx.ellipse(sx, y, r + 3, r, -0.15, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.lineCap = "round";

  for (let k = Math.floor(scrollX / 75) - 1; k * 75 - scrollX < W + 75; k++) {
    const x = k * 75 + 18 + mod(k, 2) * 8 - scrollX;
    const y = edge(x) - 2;
    const height = 22 + mod(k, 3) * 3;

    ctx.strokeStyle = mod(k, 3) === 0 ? "#568d43" : "#70a94b";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - 1, y - height * 0.45, x, y - height);
    ctx.stroke();

    ctx.fillStyle = "#79b94f";

    ctx.beginPath();
    ctx.ellipse(x - 6, y - height * 0.63, 5, 2.8, -0.55, 0, Math.PI * 2);
    ctx.ellipse(x + 6, y - height * 0.82, 5.5, 3, 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  if (follicleImg.complete && follicleImg.naturalWidth) {
    const spriteW = 48;
    const spriteH = 80;
    const surfaceInSprite = spriteH * 0.62;

    for (let k = Math.floor(scrollX / 132) - 1; k * 132 - scrollX < W + 60; k++) {
      const sx = k * 132 + 40 - scrollX;

      if (sx < -40) continue;

      const slope = (edge(sx + 4) - edge(sx - 4)) / 8;

      ctx.save();
      ctx.translate(sx, edge(sx) + 2);
      ctx.rotate(Math.atan(slope) * 0.5);
      ctx.scale(mod(k, 2) ? -1 : 1, 1);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.drawImage(follicleImg, -spriteW / 2, -surfaceInSprite, spriteW, spriteH);
      ctx.restore();
    }
  }

  ctx.fillStyle = "rgba(255,255,255,.93)";
  ctx.font = "800 13px system-ui";
  ctx.textAlign = "center";

  ctx.save();
  ctx.shadowColor = "rgba(120,30,45,.65)";
  ctx.shadowBlur = 4;
  ctx.fillText("Hair Growth Threshold", W / 2, H - 14);
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(1, edge(1));

  for (let x = 1; x <= W - 1; x += 4) {
    ctx.lineTo(x, edge(x));
  }

  ctx.lineTo(W - 1, H - 18);
  ctx.quadraticCurveTo(W - 1, H - 1, W - 18, H - 1);
  ctx.lineTo(18, H - 1);
  ctx.quadraticCurveTo(1, H - 1, 1, H - 18);
  ctx.closePath();

  ctx.strokeStyle = "rgba(38,25,24,.95)";
  ctx.lineWidth = 5;
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.beginPath();

  for (let x = 0; x <= W; x += 4) {
    const y = edge(x) + 1;

    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.strokeStyle = "rgba(255,242,220,.8)";
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function spawnBubble() {
  const worldX = scrollX + W + BUBBLE_RADIUS + 12;
  const terrain = terrainAt(worldX);

  const top = terrain.top + BUBBLE_RADIUS + 14;
  const bottom = terrain.bottom - BUBBLE_RADIUS - 14;

  if (bottom <= top) return;

  bubble = {
    worldX,
    y: top + Math.random() * (bottom - top),
    pulse: Math.random() * Math.PI * 2
  };
}

function drawBubble() {
  if (!bubble) return;

  const x = bubble.worldX - scrollX;

  if (x < -BUBBLE_RADIUS - 4 || x > W + BUBBLE_RADIUS + 4) return;

  const pulse = Math.sin(frame * 0.09 + bubble.pulse) * 1.5;
  const r = BUBBLE_RADIUS + pulse;

  ctx.save();
  ctx.shadowColor = "rgba(255,255,255,.95)";
  ctx.shadowBlur = 17;

  const glow = ctx.createRadialGradient(
    x - r * 0.35,
    bubble.y - r * 0.4,
    2,
    x,
    bubble.y,
    r * 1.3
  );

  glow.addColorStop(0, "rgba(255,255,255,.98)");
  glow.addColorStop(0.28, "rgba(185,255,255,.88)");
  glow.addColorStop(0.72, "rgba(75,220,255,.48)");
  glow.addColorStop(1, "rgba(255,255,255,.18)");

  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, bubble.y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,.95)";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.beginPath();
  ctx.ellipse(
    x - r * 0.32,
    bubble.y - r * 0.38,
    r * 0.23,
    r * 0.12,
    -0.6,
    0,
    Math.PI * 2
  );
  ctx.fill();

  ctx.restore();
}

function drawBonusPopup() {
  if (!bonusPopup) return;

  const age = bonusPopup.age;
  const alpha = Math.max(0, 1 - age / 900);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.font = "900 20px system-ui";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0,95,130,.65)";
  ctx.strokeText("+100", bonusPopup.x, bonusPopup.y - age * 0.035);
  ctx.fillStyle = "#fff36b";
  ctx.fillText("+100", bonusPopup.x, bonusPopup.y - age * 0.035);
  ctx.restore();
}

function drawPill() {
  ctx.save();
  ctx.translate(pill.x, pill.y);
  ctx.rotate(Math.max(-0.5, Math.min(0.55, pill.vy * 0.06)));

  ctx.fillStyle = "rgba(18,69,84,.22)";
  ctx.beginPath();
  ctx.ellipse(1, 8, 27, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.roundRect(-25, -14, 50, 28, 14);
  ctx.fillStyle = "#fffdf4";
  ctx.fill();

  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#e94e5e";
  ctx.fillRect(0, -16, 27, 32);
  ctx.restore();

  ctx.strokeStyle = "#e4e0d6";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-25, -14, 50, 28, 14);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(0, 10);
  ctx.stroke();

  ctx.restore();
}

function drawIntroLabel() {
  if (!running || introMs <= 0) return;

  ctx.save();
  ctx.globalAlpha = Math.min(1, introMs / 400);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,60,80,.55)";
  ctx.shadowBlur = 6;
  ctx.font = "800 17px system-ui";
  ctx.fillText("Optimal Therapeutic Window", W / 2, H / 2 - 4);
  ctx.font = "800 12px system-ui";
  ctx.fillText("DON'T TOUCH THE BORDERS", W / 2, H / 2 + 16);
  ctx.restore();
}

function drawScore() {
  ctx.textAlign = "center";
  ctx.font = "800 28px system-ui";
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.fillText(String(score), W / 2, 100);
}

// ---------------------------------------------------------------------------
// TIME-BASED GAME UPDATE
// ---------------------------------------------------------------------------

function update(dt) {
  if (!running || paused || dt <= 0) return;

  // Convert elapsed milliseconds into equivalent original 120 Hz frames.
  // At 120 Hz this is approximately 1.
  // At 60 Hz this is approximately 2.
  const timeScale = dt / (1000 / 120);

  frame += timeScale;

  bubbleElapsedMs += dt;
  introMs = Math.max(0, introMs - dt);

  if (bubbleElapsedMs >= BUBBLE_INTERVAL_MS) {
    bubbleElapsedMs -= BUBBLE_INTERVAL_MS;
    spawnBubble();
  }

  if (bonusPopup) {
    bonusPopup.age += dt;

    if (bonusPopup.age >= 900) {
      bonusPopup = null;
    }
  }

  // Physics: integrate gravity using elapsed time.
  const timeToTerminal = Math.max(0, (MAX_FALL - pill.vy) / GRAVITY);
  const acceleratingTime = Math.min(timeScale, timeToTerminal);

  pill.y += pill.vy * timeScale
    + 0.5 * GRAVITY * acceleratingTime * (acceleratingTime - 1)
    + MAX_FALL * (timeScale - acceleratingTime);

  pill.vy = Math.min(pill.vy + GRAVITY * timeScale, MAX_FALL);

  // Damage cooldown.
  if (damageCooldown > 0) {
    damageCooldown = Math.max(0, damageCooldown - timeScale);
  }

  // Recover scroll speed after damage.
  if (damageCooldown === 0 && speedMod < 1) {
    speedMod = Math.min(1, speedMod + SPEED_RECOVERY * timeScale);
  }

  // Scroll at the same real-world speed regardless of refresh rate.
  scrollX += scrollSpeed() * timeScale;

  ensureTerrain();

  // Score for passing pinch points.
  for (const key of keys) {
    if (key.pinch && !key.passed && key.x - scrollX < pill.x) {
      key.passed = true;
      score += 5;
      scoreLabel.textContent = score;
    }
  }

  // Collect bonus bubble.
  if (bubble) {
    const bubbleX = bubble.worldX - scrollX;
    const dx = bubbleX - pill.x;
    const dy = bubble.y - pill.y;

    if (dx * dx + dy * dy <= (BUBBLE_RADIUS + 20) ** 2) {
      score += BUBBLE_BONUS;
      scoreLabel.textContent = score;

      bonusPopup = {
        x: bubbleX,
        y: bubble.y,
        age: 0
      };

      bubble = null;
    } else if (bubbleX < -BUBBLE_RADIUS) {
      bubble = null;
    }
  }

  // Collision detection.
  let hit = null;

  for (let dx = -22; dx <= 22; dx += 6) {
    const sx = pill.x + dx;

    if (pill.y - 12 < topEdgeAt(sx)) {
      hit = "top";
    }

    if (pill.y + 12 > bottomEdgeAt(sx)) {
      hit = "bottom";
    }
  }

  if (hit) {
    loseLife(hit);
  }

  // One score point per six original 120 Hz frames.
  scoreFrameAccumulator += timeScale;

  while (scoreFrameAccumulator >= 6) {
    scoreFrameAccumulator -= 6;
    score++;
    scoreLabel.textContent = score;
  }
}

function render() {
  drawBackground();
  drawCardiacThreshold();
  drawHairThreshold();
  drawIntroLabel();
  drawScore();
  drawBubble();
  drawBonusPopup();

  if (pill) {
    if (damageCooldown === 0 || Math.floor(damageCooldown / 5) % 2 === 0) {
      drawPill();
    }
  }
}

function togglePause() {
  if (!running) return;

  paused = !paused;

  pausedTag.classList.toggle("visible", paused);
  pauseButton.textContent = paused ? "▶" : "Ⅱ";
}

function handleFlap() {
  if (!running) return;
  if (!paused) flap();
}

startButton.addEventListener("click", () => {
  reset();
  flap();
});

restartButton.addEventListener("click", () => {
  reset();
  flap();
});

pauseButton.addEventListener("click", togglePause);

canvas.addEventListener("pointerdown", handleFlap);

window.addEventListener("keydown", event => {
  if (event.code === "Space" || event.code === "ArrowUp") {
    event.preventDefault();

    if (!running && !overlay.classList.contains("hidden")) {
      return;
    }

    handleFlap();
  }
});

// ---------------------------------------------------------------------------
// INITIALIZATION
// ---------------------------------------------------------------------------

pill = { x: 118, y: 340, vy: 0 };
score = 0;
lives = 3;
running = false;
paused = false;
frame = 0;
scoreFrameAccumulator = 0;
damageCooldown = 0;
speedMod = 1;
introMs = 0;
bubble = null;
bubbleElapsedMs = 0;
bonusPopup = null;

initTerrain();
updateLives();

// ---------------------------------------------------------------------------
// REFRESH-RATE-INDEPENDENT GAME LOOP
// ---------------------------------------------------------------------------

// Update once per display frame.
// The amount of game time advanced is based on actual elapsed time.
let lastTime = performance.now();

document.addEventListener("visibilitychange", () => {
  lastTime = performance.now();
});

function loop(now = performance.now()) {
  const elapsed = Math.max(0, now - lastTime);
  lastTime = now;

  if (running && !paused && !document.hidden) {
    update(elapsed);
  }

  render();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);