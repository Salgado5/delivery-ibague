/**
 * algorithms.js — RouteForge CVRP Engine
 * Implements: Backtracking+Pruning, Greedy Nearest Neighbor,
 *             Knapsack DP (peso x volumen), Empaquetado 3D (guillotina),
 *             2-opt, Dijkstra (matriz de adyacencia), Kruskal MST,
 *             Divide & Conquer sorting.
 */

"use strict";

/* ═══════════════════════════════════════════════
   UTILITY: Haversine distance (km) between two lat/lng points
   ═══════════════════════════════════════════════ */
function haversine(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const c =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinLng *
      sinLng;
  return R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

/* ═══════════════════════════════════════════════
   BUILD DISTANCE MATRIX
   ═══════════════════════════════════════════════ */
// Las calles no son línea recta: factor de tortuosidad urbana (Ibagué ≈ 1.3)
const FACTOR_URBANO = 1.3;

function buildDistMatrix(points) {
  const n = points.length;
  const dist = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversine(points[i], points[j]) * FACTOR_URBANO;
      dist[i][j] = d;
      dist[j][i] = d;
    }
  }
  return dist;
}

/* ═══════════════════════════════════════════════
   DIJKSTRA — Shortest path from depot (idx 0)
   ═══════════════════════════════════════════════ */
function dijkstra(distMatrix, source = 0) {
  const n = distMatrix.length;
  const dist = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  const visited = new Array(n).fill(false);
  dist[source] = 0;

  for (let iter = 0; iter < n; iter++) {
    // Find unvisited node with minimum distance
    let u = -1;
    for (let v = 0; v < n; v++) {
      if (!visited[v] && (u === -1 || dist[v] < dist[u])) u = v;
    }
    if (u === -1 || dist[u] === Infinity) break;
    visited[u] = true;

    for (let v = 0; v < n; v++) {
      if (!visited[v] && distMatrix[u][v] > 0) {
        const alt = dist[u] + distMatrix[u][v];
        if (alt < dist[v]) {
          dist[v] = alt;
          prev[v] = u;
        }
      }
    }
  }

  return { dist, prev };
}

/* ═══════════════════════════════════════════════
   KRUSKAL — Minimum Spanning Tree (for connectivity analysis)
   ═══════════════════════════════════════════════ */
function kruskal(distMatrix) {
  const n = distMatrix.length;
  const edges = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      edges.push({ u: i, v: j, w: distMatrix[i][j] });
    }
  }
  // Sort edges by weight (using merge sort via JS built-in Timsort)
  edges.sort((a, b) => a.w - b.w);

  // Union-Find
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array(n).fill(0);
  function find(x) {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }
  function union(x, y) {
    const rx = find(x),
      ry = find(y);
    if (rx === ry) return false;
    if (rank[rx] < rank[ry]) parent[rx] = ry;
    else if (rank[rx] > rank[ry]) parent[ry] = rx;
    else {
      parent[ry] = rx;
      rank[rx]++;
    }
    return true;
  }

  const mst = [];
  let totalWeight = 0;
  for (const edge of edges) {
    if (union(edge.u, edge.v)) {
      mst.push(edge);
      totalWeight += edge.w;
      if (mst.length === n - 1) break;
    }
  }
  return { mst, totalWeight };
}
/* ═══════════════════════════════════════════════
   KNAPSACK 0/1 BIDIMENSIONAL (PD, tabulación bottom-up)
   Elige qué paquetes cargar maximizando el valor sin pasar
   la capacidad de PESO ni de VOLUMEN del vehículo.

   Recurrencia:  dp[i][w][v] = max( dp[i-1][w][v],
                                    val_i + dp[i-1][w-w_i][v-v_i] )

   La tabla se discretiza en STEPS x STEPS celdas (peso y volumen se
   redondean al entero más cercano). Como el redondeo puede errar por
   unas décimas de celda, seleccionarCarga() revalida después con los
   valores EXACTOS de peso/volumen y con el empaquetado 3D.
   Complejidad: O(n · STEPS²) tiempo, O(n · STEPS²) memoria (para reconstruir).
   items = [{weight (kg), volume (m³), value}]  →  devuelve índices elegidos
   ═══════════════════════════════════════════════ */
function knapsack2D(items, maxWeight, maxVolume, STEPS = 120) {
  const n = items.length;
  if (n === 0 || maxWeight <= 0 || maxVolume <= 0) return [];
  if (n > 800) return knapsackGreedy(items, maxWeight, maxVolume); // protección de memoria

  const W = STEPS,
    V = STEPS;
  const wu = maxWeight / W; // kg por celda
  const vu = maxVolume / V; // m³ por celda
  const iw = items.map((it) => Math.round(it.weight / wu));
  const iv = items.map((it) => Math.round(it.volume / vu));
  const val = items.map(
    (it) => it.value || it.weight + it.volume * 10,
  );

  const dp = Array.from({ length: W + 1 }, () => new Float64Array(V + 1));
  const keep = new Uint8Array(n * (W + 1) * (V + 1));
  const idx = (i, w, v) => (i * (W + 1) + w) * (V + 1) + v;

  for (let i = 0; i < n; i++) {
    if (iw[i] > W || iv[i] > V) continue; // no cabe ni solo
    for (let w = W; w >= iw[i]; w--) {
      for (let v = V; v >= iv[i]; v--) {
        const cand = dp[w - iw[i]][v - iv[i]] + val[i];
        if (cand > dp[w][v]) {
          dp[w][v] = cand;
          keep[idx(i, w, v)] = 1;
        }
      }
    }
  }

  // Backtracking de la tabla para recuperar los ítems elegidos
  const selected = [];
  let w = W,
    v = V;
  for (let i = n - 1; i >= 0; i--) {
    if (keep[idx(i, w, v)]) {
      selected.push(i);
      w -= iw[i];
      v -= iv[i];
    }
  }
  return selected.reverse();
}

// Respaldo voraz (por densidad de valor) cuando hay demasiados ítems
function knapsackGreedy(items, maxWeight, maxVolume) {
  const indexed = items.map((it, i) => ({
    ...it,
    i,
    density:
      (it.value || it.weight + it.volume * 10) /
      (it.weight / maxWeight + it.volume / maxVolume + 1e-6),
  }));
  indexed.sort((a, b) => b.density - a.density);
  let tw = 0,
    tv = 0;
  const sel = [];
  for (const it of indexed) {
    if (tw + it.weight <= maxWeight && tv + it.volume <= maxVolume) {
      sel.push(it.i);
      tw += it.weight;
      tv += it.volume;
    }
  }
  return sel.sort((a, b) => a - b);
}

/* ═══════════════════════════════════════════════
   EMPAQUETADO 3D (heurística voraz de guillotina)
   El vehículo es una caja ancho × alto × profundidad (metros).
   Cada paquete es una caja (o un sobre plano). Se ordenan por volumen
   descendente y cada uno se coloca en el espacio libre donde deje el
   MENOR sobrante (best-fit), probando rotaciones:
     - caja  → 6 orientaciones
     - sobre → 2 orientaciones (siempre acostado, lado menor = alto)
   Al colocar un paquete, el espacio libre se parte en 3 cajas
   disjuntas (encima, a la derecha y al fondo) → todo paquete queda
   apoyado en el piso o sobre otro paquete.
   Ejes: x = ancho, y = alto (vertical), z = profundidad (puerta → fondo).
   Complejidad: O(n · F · 6), con F = nº de espacios libres (≤ 3n).
   ═══════════════════════════════════════════════ */
function orientaciones(p) {
  const dims = [p.ancho, p.alto, p.profundidad];
  let perms;
  if (p.tipo === "sobre") {
    // el lado más pequeño queda vertical
    const sorted = [...dims].sort((a, b) => a - b);
    perms = [
      [sorted[1], sorted[0], sorted[2]],
      [sorted[2], sorted[0], sorted[1]],
    ];
  } else {
    const [a, b, c] = dims;
    perms = [
      [a, b, c],
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ];
  }
  const seen = new Set();
  return perms.filter((o) => {
    const k = o.map((x) => x.toFixed(4)).join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function empacar3D(paquetes, caja) {
  const EPS = 1e-6;
  const vol = (p) => p.ancho * p.alto * p.profundidad;
  const orden = [...paquetes].sort((a, b) => vol(b) - vol(a));
  let libres = [
    { x: 0, y: 0, z: 0, w: caja.ancho, h: caja.alto, d: caja.profundidad },
  ];
  const colocados = [];
  const noCaben = [];

  for (const p of orden) {
    let best = null;
    libres.forEach((f, fi) => {
      for (const [w, h, d] of orientaciones(p)) {
        if (w <= f.w + EPS && h <= f.h + EPS && d <= f.d + EPS) {
          const sobrante = f.w * f.h * f.d - w * h * d;
          if (
            !best ||
            sobrante < best.sobrante - EPS ||
            (Math.abs(sobrante - best.sobrante) <= EPS &&
              (f.y < best.f.y - EPS ||
                (Math.abs(f.y - best.f.y) <= EPS && f.z < best.f.z)))
          )
            best = { fi, f, w, h, d, sobrante };
        }
      }
    });
    if (!best) {
      noCaben.push(p);
      continue;
    }
    const { f, w, h, d, fi } = best;
    colocados.push({ id: p.id, pedido: p, x: f.x, y: f.y, z: f.z, w, h, d });
    libres.splice(fi, 1);
    const nuevos = [
      { x: f.x, y: f.y + h, z: f.z, w: w, h: f.h - h, d: d }, // encima
      { x: f.x + w, y: f.y, z: f.z, w: f.w - w, h: f.h, d: d }, // a la derecha
      { x: f.x, y: f.y, z: f.z + d, w: f.w, h: f.h, d: f.d - d }, // al fondo
    ].filter((b) => b.w > 0.005 && b.h > 0.005 && b.d > 0.005);
    libres.push(...nuevos);
  }
  return { colocados, noCaben };
}

/* ═══════════════════════════════════════════════
   SELECCIÓN DE CARGA = Knapsack (peso+volumen) + verificación 3D
   1) El knapsack propone el mejor conjunto por peso y volumen.
   2) El empaquetado 3D comprueba que REALMENTE quepan (geometría).
   3) Si alguno no cabe, se descarta el más grande y se repite.
   ═══════════════════════════════════════════════ */
const PRIORIDAD_VALOR = { alta: 300, media: 200, baja: 100 };

function seleccionarCarga(candidatos, vehiculo, log = []) {
  let pool = [...candidatos];
  const caja = {
    ancho: vehiculo.ancho,
    alto: vehiculo.alto,
    profundidad: vehiculo.profundidad,
  };
  let ultimo = { colocados: [], noCaben: [] };

  for (let intento = 0; intento < 80 && pool.length > 0; intento++) {
    const items = pool.map((p) => ({
      weight: p.peso,
      volume: p.volumen,
      value: (PRIORIDAD_VALOR[p.prioridad] || 100) + 10, // maximiza nº de paquetes ponderado por prioridad
    }));
    const sel = knapsack2D(items, vehiculo.capPeso, vehiculo.capVolumen, 200);
    let elegidos = sel.map((i) => pool[i]);
    if (elegidos.length === 0) return { colocados: [], noCaben: [] };

    // Revalidación exacta (el DP está discretizado): quitar lo menos valioso
    // hasta que peso y volumen reales cumplan.
    const exceso = () =>
      elegidos.reduce((s, p) => s + p.peso, 0) > vehiculo.capPeso + 1e-9 ||
      elegidos.reduce((s, p) => s + p.volumen, 0) > vehiculo.capVolumen + 1e-9;
    while (elegidos.length > 0 && exceso()) {
      elegidos.sort(
        (a, b) =>
          (PRIORIDAD_VALOR[a.prioridad] || 100) - (PRIORIDAD_VALOR[b.prioridad] || 100) ||
          b.volumen - a.volumen,
      );
      const fuera = elegidos.shift();
      pool = pool.filter((p) => p.id !== fuera.id);
    }
    if (elegidos.length === 0) return { colocados: [], noCaben: [] };

    ultimo = empacar3D(elegidos, caja);
    if (ultimo.noCaben.length === 0) {
      log.push(
        `[Knapsack+3D] ${vehiculo.tipo} #${vehiculo.id}: ${elegidos.length} paquetes caben (intento ${intento + 1})`,
      );
      return ultimo;
    }
    // quitar del pool el primero que no cupo (el más grande) y reintentar
    const fuera = ultimo.noCaben[0];
    pool = pool.filter((p) => p.id !== fuera.id);
  }
  return ultimo; // lo que sí se logró colocar
}

/* ═══════════════════════════════════════════════
   BACKTRACKING CVRP (una sola ruta, un vehículo)
   Encuentra la permutación óptima de paradas con poda por distancia.
   La capacidad ya fue garantizada por Knapsack+3D.
   ═══════════════════════════════════════════════ */
function backtrackingCVRP(distMatrix, log = []) {
  const n = distMatrix.length; // incluye depósito en 0
  const clients = Array.from({ length: n - 1 }, (_, i) => i + 1);
  let bestCost = Infinity;
  let bestRoute = null;
  let iterations = 0;
  const MAX_ITER = 400000;

  function bt(route, visited, currentDist) {
    iterations++;
    if (iterations > MAX_ITER) return; // tope de seguridad

    if (route.length === clients.length) {
      const totalDist = currentDist + distMatrix[route[route.length - 1]][0];
      if (totalDist < bestCost) {
        bestCost = totalDist;
        bestRoute = [0, ...route, 0];
      }
      return;
    }
    const last = route.length > 0 ? route[route.length - 1] : 0;
    for (const client of clients) {
      if (visited[client]) continue;
      const newDist = currentDist + distMatrix[last][client];
      if (newDist + distMatrix[client][0] >= bestCost) continue; // poda
      visited[client] = true;
      route.push(client);
      bt(route, visited, newDist);
      route.pop();
      visited[client] = false;
    }
  }

  const visited = new Array(n).fill(false);
  visited[0] = true;
  bt([], visited, 0);
  log.push(`[BT] ${clients.length} paradas · iteraciones: ${iterations}`);
  return {
    route: bestRoute || [0, ...clients, 0],
    cost: bestCost === Infinity ? routeCost(distMatrix, [0, ...clients, 0]) : bestCost,
    iterations,
  };
}

function routeCost(distMatrix, route) {
  let c = 0;
  for (let i = 0; i < route.length - 1; i++) c += distMatrix[route[i]][route[i + 1]];
  return c;
}

/* ═══════════════════════════════════════════════
   2-OPT — mejora local de una ruta (para > 9 paradas)
   Invierte tramos de la ruta mientras eso acorte la distancia.
   Complejidad: O(n²) por pasada.
   ═══════════════════════════════════════════════ */
function twoOpt(distMatrix, route) {
  let best = [...route];
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < best.length - 2; i++) {
      for (let k = i + 1; k < best.length - 1; k++) {
        const a = best[i - 1],
          b = best[i],
          c = best[k],
          d = best[k + 1];
        const delta =
          distMatrix[a][c] + distMatrix[b][d] - distMatrix[a][b] - distMatrix[c][d];
        if (delta < -1e-9) {
          best = [
            ...best.slice(0, i),
            ...best.slice(i, k + 1).reverse(),
            ...best.slice(k + 1),
          ];
          improved = true;
        }
      }
    }
  }
  return { route: best, cost: routeCost(distMatrix, best) };
}

/* ═══════════════════════════════════════════════
   GREEDY NEAREST NEIGHBOR
   ═══════════════════════════════════════════════ */
function greedyNearestNeighbor(distMatrix, demands, capacity, log = []) {
  const n = distMatrix.length;
  const visited = new Array(n).fill(false);
  visited[0] = true;
  const route = [0];
  let totalDist = 0;
  let currentWeight = 0,
    currentVolume = 0;
  let current = 0;

  while (route.length < n) {
    let nearest = -1;
    let nearestDist = Infinity;

    for (let j = 1; j < n; j++) {
      if (visited[j]) continue;
      const w = demands[j]?.weight || 0;
      const v = demands[j]?.volume || 0;
      if (currentWeight + w > capacity.weight) continue;
      if (currentVolume + v > capacity.volume) continue;
      if (distMatrix[current][j] < nearestDist) {
        nearestDist = distMatrix[current][j];
        nearest = j;
      }
    }

    if (nearest === -1) break; // No feasible neighbor
    visited[nearest] = true;
    route.push(nearest);
    totalDist += nearestDist;
    currentWeight += demands[nearest]?.weight || 0;
    currentVolume += demands[nearest]?.volume || 0;
    current = nearest;
    log.push(
      `[Voraz] Visitando nodo ${nearest} dist_parcial=${totalDist.toFixed(2)}km`,
    );
  }

  // Return to depot
  totalDist += distMatrix[current][0];
  route.push(0);
  log.push(`[Voraz] Ruta completada: dist=${totalDist.toFixed(2)}km`);
  return { route, cost: totalDist };
}

/* ═══════════════════════════════════════════════
   DIVIDE & CONQUER — Sort points by x (lng) for sweep
   ═══════════════════════════════════════════════ */
function mergeSort(arr, key = "lng") {
  if (arr.length <= 1) return arr;
  const mid = Math.floor(arr.length / 2);
  const left = mergeSort(arr.slice(0, mid), key);
  const right = mergeSort(arr.slice(mid), key);
  return merge(left, right, key);
}

function merge(left, right, key) {
  const result = [];
  let i = 0,
    j = 0;
  while (i < left.length && j < right.length) {
    if (left[i][key] <= right[j][key]) result.push(left[i++]);
    else result.push(right[j++]);
  }
  return result.concat(left.slice(i)).concat(right.slice(j));
}

/* ═══════════════════════════════════════════════
   SOLVER DE FLOTA (CVRP con carga 3D)
   Para cada vehículo (el más grande primero):
     1. Knapsack + Empaquetado 3D → qué paquetes CABEN.
     2. Agrupa los paquetes que van a la misma dirección (una parada).
     3. Optimiza el orden de las paradas (Backtracking exacto ≤ 9 paradas,
        Vecino más cercano + 2-opt si hay más; o Voraz puro).
   Si sobran paquetes, se repite por rondas (el vehículo vuelve al depósito).
   ═══════════════════════════════════════════════ */
const MAX_PARADAS_BT = 9;
const MAX_RONDAS = 6;

function claveParada(p) {
  return `${p.lat.toFixed(5)}|${p.lng.toFixed(5)}`;
}

function solveCVRP({
  depot,
  orders,
  vehicles,
  algorithm = "backtracking",
  log = [],
}) {
  if (orders.length === 0) throw new Error("No hay pedidos para optimizar.");
  if (vehicles.length === 0) throw new Error("No hay vehículos disponibles.");

  log.push(
    `[CVRP] ${orders.length} paquetes · ${vehicles.length} vehículos · algoritmo: ${algorithm}`,
  );

  // Divide y Vencerás: ordenar paquetes espacialmente
  const sortedOrders = mergeSort([...orders], "lng");
  log.push(`[D&C] Paquetes ordenados espacialmente (merge sort por longitud)`);

  // Análisis global del grafo (depósito + todos los paquetes)
  const points = [depot, ...sortedOrders];
  const distMatrix = buildDistMatrix(points);
  log.push(`[Matrix] Matriz de distancias ${points.length}x${points.length} (Haversine × ${FACTOR_URBANO})`);
  const { dist: shortestFromDepot } = dijkstra(distMatrix, 0);
  const lejano = Math.max(...shortestFromDepot.filter(Number.isFinite));
  log.push(`[Dijkstra] Destino más lejano al depósito: ${lejano.toFixed(2)} km`);
  const { totalWeight: mstWeight } = kruskal(distMatrix);
  log.push(`[Kruskal] MST = ${mstWeight.toFixed(2)} km (cota inferior de recorrido)`);

  // Paquetes que no caben en NINGÚN vehículo (peso o geometría)
  const noAsignados = [];
  let restantes = [];
  for (const p of sortedOrders) {
    const cabeEnAlguno = vehicles.some(
      (v) =>
        p.peso <= v.capPeso && empacar3D([p], v).noCaben.length === 0,
    );
    if (cabeEnAlguno) restantes.push(p);
    else {
      noAsignados.push(p);
      log.push(`[WARN] Paquete #${p.id} (${p.tipo}, ${p.peso}kg) no cabe en ningún vehículo`);
    }
  }

  const flota = [...vehicles].sort((a, b) => b.capVolumen - a.capVolumen);
  const results = [];
  let tripNumber = 0;

  for (let ronda = 1; ronda <= MAX_RONDAS && restantes.length > 0; ronda++) {
    let usoAlguno = false;
    for (const vehicle of flota) {
      if (restantes.length === 0) break;

      const carga = seleccionarCarga(restantes, vehicle, log);
      if (carga.colocados.length === 0) continue;
      usoAlguno = true;
      tripNumber++;

      const paquetes = carga.colocados.map((c) => c.pedido);

      // Paradas únicas (paquetes a la misma dirección = 1 parada)
      const mapaParadas = new Map();
      paquetes.forEach((p) => {
        const k = claveParada(p);
        if (!mapaParadas.has(k)) mapaParadas.set(k, { lat: p.lat, lng: p.lng, paquetes: [] });
        mapaParadas.get(k).paquetes.push(p);
      });
      const paradas = [...mapaParadas.values()];
      const nodos = [depot, ...paradas];
      const subDist = buildDistMatrix(nodos);
      const sinDemanda = nodos.map(() => ({ weight: 0, volume: 0 }));
      const capInf = { weight: Infinity, volume: Infinity };

      log.push(
        `[Trip ${tripNumber}] ${vehicle.tipo} #${vehicle.id}: ${paquetes.length} paquetes en ${paradas.length} paradas`,
      );

      let btResult = null,
        greedyResult = null;

      const resolverExacto = () => {
        if (paradas.length <= MAX_PARADAS_BT) {
          return { ...backtrackingCVRP(subDist, log), metodo: "backtracking" };
        }
        log.push(`[2-opt] ${paradas.length} paradas > ${MAX_PARADAS_BT}: Vecino cercano + 2-opt`);
        const nn = greedyNearestNeighbor(subDist, sinDemanda, capInf, []);
        const mejorada = twoOpt(subDist, nn.route);
        log.push(`[2-opt] ${nn.cost.toFixed(2)} km → ${mejorada.cost.toFixed(2)} km`);
        return { ...mejorada, iterations: 0, metodo: "2-opt" };
      };

      if (algorithm === "backtracking" || algorithm === "ambos") btResult = resolverExacto();
      if (algorithm === "voraz" || algorithm === "ambos")
        greedyResult = greedyNearestNeighbor(subDist, sinDemanda, capInf, log);

      const activo = algorithm === "voraz" ? greedyResult : btResult;
      const rutaIdx = activo.route; // índices en nodos (0 = depósito)

      // Entrega en orden de visita: lista de paquetes por parada
      const orden = rutaIdx.slice(1, -1).map((i, k) => ({
        n: k + 1,
        parada: paradas[i - 1],
      }));

      const distKm = activo.cost;
      results.push({
        tripNumber,
        ronda,
        vehicle,
        algorithm,
        metodo: algorithm === "voraz" ? "voraz" : btResult.metodo,
        routePoints: rutaIdx.map((i) => nodos[i]),
        selectedOrders: orden.flatMap((o) => o.parada.paquetes),
        paradas: orden,
        carga: carga.colocados,
        distKm,
        timeMin: vehicle.calcTime(distKm),
        fuelL: vehicle.calcFuel(distKm),
        btResult: btResult && { cost: btResult.cost, iterations: btResult.iterations, metodo: btResult.metodo },
        greedyResult: greedyResult && { cost: greedyResult.cost },
      });

      const idsCargados = new Set(paquetes.map((p) => p.id));
      restantes = restantes.filter((p) => !idsCargados.has(p.id));
    }
    if (!usoAlguno) break;
  }

  if (restantes.length > 0) {
    restantes.forEach((p) => noAsignados.push(p));
    log.push(`[WARN] ${restantes.length} paquetes sin entregar tras ${MAX_RONDAS} rondas`);
  }
  log.push(`[CVRP] Solución completada: ${results.length} rutas generadas`);
  results.noAsignados = noAsignados;
  return results;
}
