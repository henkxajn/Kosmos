import { Camera2D } from "./render/Camera2D.js";
import { Renderer2D } from "./render/Renderer2D.js";
import { AU, G } from "./sim/WorldGen.js";

const canvas = document.getElementById("c");
const status = document.getElementById("status");
const inspector = document.getElementById("inspector");
const speedSelect = document.getElementById("speed");
const selectBody = document.getElementById("selectBody");
const followChk = document.getElementById("followChk");

const worker = new Worker("./src/worker/sim.worker.js", { type: "module" });

const camera = new Camera2D(canvas);
const renderer = new Renderer2D(canvas, camera);

let prevSnap = null;
let nextSnap = null;
let prevWall = 0;
let nextWall = 0;

let paused = false;
let selectedId = null;

function send(msg) { worker.postMessage(msg); }
function setText(el, text) { el.textContent = text; }

function fmtTime(t) {
  const days = t / 86400;
  const years = days / 365.25;
  return `${t.toFixed(1)} s  (~${days.toFixed(2)} d, ~${years.toFixed(3)} y)`;
}
function fmtAU(m) { return (m / AU).toFixed(4) + " AU"; }
function fmtKm(m) { return (m / 1000).toFixed(0) + " km"; }

function getBody(snapshot, id) {
  return snapshot?.bodies?.find(b => b.id === id) ?? null;
}
function getParent(snapshot, body) {
  if (!body?.orbit?.parentId) return null;
  return getBody(snapshot, body.orbit.parentId);
}

function rebuildSelect(snapshot) {
  const current = selectBody.value;

  selectBody.innerHTML = "";
  const def = document.createElement("option");
  def.value = "";
  def.textContent = "(kliknij na mapie)";
  selectBody.appendChild(def);

  const groups = { star: [], planet: [], moon: [] };
  for (const b of snapshot.bodies) groups[b.type]?.push(b);

  const addGroup = (label, items) => {
    if (!items.length) return;
    const og = document.createElement("optgroup");
    og.label = label;
    for (const b of items) {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = b.name;
      og.appendChild(opt);
    }
    selectBody.appendChild(og);
  };

  addGroup("Gwiazda", groups.star);
  addGroup("Planety", groups.planet);
  addGroup("Księżyce", groups.moon);

  if ([...selectBody.options].some(o => o.value === current)) {
    selectBody.value = current;
  } else {
    selectBody.value = selectedId || "";
  }
}

function setSelected(id) {
  selectedId = id || null;
  renderer.setSelectedId(selectedId);
  if (followChk.checked) camera.setFollow(selectedId);
}

selectBody.onchange = () => setSelected(selectBody.value || null);

followChk.onchange = () => {
  if (!followChk.checked) camera.setFollow(null);
  else camera.setFollow(selectedId);
};

document.getElementById("pause").onclick = () => {
  paused = !paused;
  send({ type: "SET_PAUSED", paused });
};

document.getElementById("resetCam").onclick = () => camera.reset();

document.getElementById("center").onclick = () => {
  if (!nextSnap || !selectedId) return;
  const b = getBody(nextSnap, selectedId);
  if (!b) return;
  camera.centerOnWorld(b.position.x, b.position.y, renderer.pxPerMeter());
};

speedSelect.onchange = () => send({ type: "SET_TIMESCALE", timeScale: Number(speedSelect.value) });

renderer.onPick = (pickedId) => {
  if (!pickedId) return;
  selectBody.value = pickedId;
  setSelected(pickedId);
};

worker.onmessage = (ev) => {
  const msg = ev.data;

  if (msg.type === "READY") return;
  if (msg.type === "LOG") { console.log("[worker]", msg.message); return; }

  if (msg.type === "SNAPSHOT") {
    const now = performance.now();
    if (!nextSnap) {
      prevSnap = msg.snapshot;
      nextSnap = msg.snapshot;
      prevWall = now;
      nextWall = now;

      rebuildSelect(msg.snapshot);

      const firstPlanet = msg.snapshot.bodies.find(b => b.type === "planet")?.id || "star-0";
      setSelected(firstPlanet);
      return;
    }

    prevSnap = nextSnap;
    prevWall = nextWall;
    nextSnap = msg.snapshot;
    nextWall = now;

    renderer.setOrbitCacheFromSnapshot(msg.snapshot);
    rebuildSelect(msg.snapshot);
  }
};

send({ type: "INIT", seed: "demo-seed-001" });
send({ type: "SET_TIMESCALE", timeScale: Number(speedSelect.value) });

function buildInspectorText(snapshot) {
  if (!snapshot || !selectedId) return "Kliknij planetę/księżyc/gwiazdę…";
  const b = getBody(snapshot, selectedId);
  if (!b) return "Brak danych (ciało nie istnieje w snapshot).";

  const parent = getParent(snapshot, b);

  const gSurf = (G * b.mass) / (b.radius * b.radius);
  const massEarth = b.mass / 5.972e24;
  const rEarth = b.radius / 6.371e6;

  let distToParent = "";
  if (parent) {
    const dx = b.position.x - parent.position.x;
    const dy = b.position.y - parent.position.y;
    const dz = b.position.z - parent.position.z;
    const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
    distToParent = `${fmtAU(d)}  (${fmtKm(d)})`;
  }

  let orbitInfo = "—";
  if (b.orbit) {
    const incDeg = (b.orbit.inclination * 180 / Math.PI).toFixed(2);
    const perDays = b.periodSeconds ? (b.periodSeconds / 86400).toFixed(2) + " d" : "—";
    orbitInfo =
      `a: ${fmtAU(b.orbit.semiMajorAxis)}\n` +
      `e: ${b.orbit.eccentricity.toFixed(3)}\n` +
      `i: ${incDeg}°\n` +
      `period: ${perDays}`;
  }

  const lines = [];
  lines.push(`${b.name}  [${b.type}]`);
  if (parent) lines.push(`parent: ${parent.name}`);
  lines.push("");
  lines.push(`mass: ${(b.mass).toExponential(3)} kg  (${massEarth.toFixed(3)} M⊕)`);
  lines.push(`radius: ${fmtKm(b.radius)}  (${rEarth.toFixed(3)} R⊕)`);
  lines.push(`g(surface): ${gSurf.toFixed(2)} m/s²`);
  if (distToParent) lines.push(`distance to parent: ${distToParent}`);
  lines.push("");
  lines.push("orbit:");
  lines.push(orbitInfo);
  return lines.join("\n");
}

function animate() {
  requestAnimationFrame(animate);

  if (prevSnap && nextSnap && nextWall > prevWall) {
    const now = performance.now();
    const alpha = Math.max(0, Math.min(1, (now - prevWall) / (nextWall - prevWall)));
    const interp = renderer.interpolateSnapshots(prevSnap, nextSnap, alpha);
    renderer.render(interp);

    const follow = camera.followId ? `follow=${camera.followId}` : "follow=(free)";
    setText(status,
      `seed: ${interp.seed}\n` +
      `time: ${fmtTime(interp.timeSeconds)}\n` +
      `paused=${interp.paused}  timeScale=${interp.timeScale}  ${follow}\n` +
      `zoom=${camera.zoom.toFixed(3)}\n` +
      `bodies: ${interp.bodies.length}`
    );
    setText(inspector, buildInspectorText(interp));
  } else if (nextSnap) {
    renderer.render(nextSnap);
    setText(inspector, buildInspectorText(nextSnap));
  }
}

animate();
