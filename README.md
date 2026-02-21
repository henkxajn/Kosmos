# Pastel Orbits — Stage 1 (Fundament symulacji)

To jest minimalny szkielet **Etapu 1**: symulacja w **Web Worker**, deterministyczny generator układu (seed), ruch po orbitach Keplera i snapshoty stanu.

## Wymagania
- Node.js (LTS) + npm

## Start lokalnie
```bash
npm install
npm run dev
```

Otwórz adres z terminala (zwykle `http://localhost:5173/`).
Logi zobaczysz też w **DevTools → Console**.

## Co tu jest
- `src/worker/sim.worker.ts` — worker z pętlą symulacji
- `src/sim/WorldGen.ts` — generator gwiazda + 3–9 planet + księżyce
- `src/sim/systems/OrbitSystem.ts` — Kepler: elementy orbity → pozycje i okresy
- `src/sim/SimEngine.ts` — fixed timestep + timeScale + snapshot

## Upload na GitHub
Możesz:
1. Utworzyć repo na GitHub.
2. W GitHub Desktop: **Add local repository** / **Open** i wskazać ten folder.
3. Commit + Push.

Albo wrzucić pliki przez stronę GitHub (Upload files).
