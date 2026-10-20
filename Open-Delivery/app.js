/**
 * app.js — RouteForge UI Controller (Ibagué, Tolima)
 * Handles map (Leaflet + OSM), geocoding (Nominatim),
 * route drawing, and UI state management.
 */

"use strict";

/* ═══════════════════════════════════════════════
   APP STATE
   ═══════════════════════════════════════════════ */
// Centro de Ibagué (Plaza de Bolívar)
const IBAGUE = { lat: 4.4389, lng: -75.2322 };

const App = {
  empresa: new EmpresaLogistica("RouteForge Logistics · Ibagué"),
  map: null,
  markers: { depot: null, orders: [], routes: [] },
  drawGen: 0, // invalida dibujos asíncronos pendientes al limpiar rutas
  currentPanel: "pedidos",
};

/* ═══════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════ */
function showToast(msg, type = "info", duration = 3000) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  setTimeout(() => {
    toast.className = "toast";
  }, duration);
}

/* ═══════════════════════════════════════════════
   STATUS
   ═══════════════════════════════════════════════ */
function setStatus(text) {
  document.getElementById("statusText").textContent = text;
}

/* ═══════════════════════════════════════════════
   MAP INIT
   ═══════════════════════════════════════════════ */
function initMap() {
  App.map = L.map("map", {
    center: [IBAGUE.lat, IBAGUE.lng],
    zoom: 13,
    zoomControl: true,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(App.map);

  // Depot marker
  placeDepotMarker(App.empresa.deposito.lat, App.empresa.deposito.lng);

  // Búsqueda de direcciones sesgada a Ibagué (viewbox) — ver geocode()
  // Click on map to add order
  App.map.on("click", (e) => {
    const { lat, lng } = e.latlng;
    document.getElementById("inputLat").value = lat.toFixed(5);
    document.getElementById("inputLng").value = lng.toFixed(5);
    document.getElementById("inputDireccion").value =
      `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    showCoordRow(true);
    showToast("Coordenadas cargadas. Completa el formulario.", "info");
  });
}

function placeDepotMarker(lat, lng) {
  if (App.markers.depot) App.markers.depot.remove();
  const icon = L.divIcon({
    className: "",
    html: '<div class="marker-depot"></div>',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });
  App.markers.depot = L.marker([lat, lng], { icon })
    .addTo(App.map)
    .bindPopup("<b>⬡ Depósito</b><br>Punto de origen");
}

function placeOrderMarker(pedido) {
  const icon = L.divIcon({
    className: "",
    html: `<div class="marker-order">${pedido.id}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
  const marker = L.marker([pedido.lat, pedido.lng], { icon }).addTo(App.map)
    .bindPopup(`
      <b>${pedido.icono} ${pedido.codigo}</b><br>
      📍 ${pedido.direccion}<br>
      ⚖️ ${pedido.peso} kg | 📐 ${pedido.dimsCm}<br>
      📦 ${(pedido.volumen * 1000).toFixed(1)} L · 🏷️ ${pedido.prioridad}
    `);
  App.markers.orders.push({ id: pedido.id, marker });
}

function removeOrderMarker(id) {
  const idx = App.markers.orders.findIndex((m) => m.id === id);
  if (idx !== -1) {
    App.markers.orders[idx].marker.remove();
    App.markers.orders.splice(idx, 1);
  }
}

function clearRouteLines() {
  App.drawGen++;
  App.markers.routes.forEach((l) => l.remove());
  App.markers.routes = [];
}

async function drawRoute(ruta, colorOverride = null) {
  const colors = { backtracking: "#f5a623", voraz: "#3b82f6", ambos: "#f5a623" };
  const color = colorOverride || colors[ruta.algoritmo] || "#f5a623";
  const gen = App.drawGen;

  // Trazado por calles reales (OSRM); si falla, línea recta como respaldo
  if (!ruta._via) ruta._via = await getRoadRoute(ruta.puntos);
  if (gen !== App.drawGen) return; // el usuario limpió/cambió mientras se descargaba

  const via = ruta._via;
  const latlngs = via ? via.coords.map((c) => [c.lat, c.lng]) : ruta.puntos.map((p) => [p.lat, p.lng]);

  const line = L.polyline(latlngs, {
    color,
    weight: via ? 4 : 3,
    opacity: 0.85,
    dashArray: via ? null : "8,6",
  }).addTo(App.map);
  App.markers.routes.push(line);

  if (via) {
    const el = document.getElementById(`via-${ruta._idx}`);
    if (el) el.innerHTML = `🛣️ Por calles: <strong>${via.km.toFixed(1)} km</strong> · <strong>${Math.round(via.min)} min</strong> (OSRM, sin tráfico)`;
  } else if (!App._avisoOSRM) {
    App._avisoOSRM = true;
    showToast("No se pudo obtener la ruta por calles (OSRM); se muestra en línea recta", "error", 5000);
  }

  // Parada n (orden de visita)
  ruta.paradas.forEach((p) => {
    const mk = L.circleMarker([p.parada.lat, p.parada.lng], {
      radius: 5,
      color,
      fillColor: "#0a0b0d",
      fillOpacity: 1,
      weight: 2,
    })
      .addTo(App.map)
      .bindTooltip(`${p.n}`, { permanent: ruta.paradas.length <= 25, direction: "top", offset: [0, -4], className: "stop-tip" })
      .bindPopup(
        `<b>Parada ${p.n}</b> · ${ruta.vehiculo.icon} ${ruta.vehiculo.tipo} #${ruta.vehiculo.id}<br>` +
          p.parada.paquetes.map((q) => `${q.icono} ${q.codigo} (${q.peso} kg)`).join("<br>"),
      );
    App.markers.routes.push(mk);
  });

  App.map.fitBounds(line.getBounds(), { padding: [40, 40] });
}

/* ═══════════════════════════════════════════════
   RUTA POR CALLES — OSRM (OpenStreetMap, gratis, sin API key)
   Devuelve { coords:[{lat,lng}], km, min } o null si falla.
   El servidor demo limita el nº de puntos, así que se parte en tramos.
   Es el mismo tipo de ruteo que Maps/Waze (sin tráfico en vivo).
   ═══════════════════════════════════════════════ */
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
const OSRM_MAX_PUNTOS = 80;

async function getRoadRoute(puntos) {
  if (puntos.length < 2) return null;
  try {
    // tramos que comparten el punto de unión
    const tramos = [];
    for (let i = 0; i < puntos.length - 1; i += OSRM_MAX_PUNTOS - 1)
      tramos.push(puntos.slice(i, i + OSRM_MAX_PUNTOS));
    const coords = [];
    let km = 0,
      min = 0;
    for (const t of tramos) {
      if (t.length < 2) continue;
      const path = t.map((p) => `${p.lng},${p.lat}`).join(";");
      const res = await fetch(`${OSRM_URL}/${path}?overview=full&geometries=geojson&continue_straight=false`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.code !== "Ok" || !data.routes[0]) return null;
      const r = data.routes[0];
      r.geometry.coordinates.forEach(([lng, lat]) => coords.push({ lat, lng }));
      km += r.distance / 1000;
      min += r.duration / 60;
    }
    return { coords, km, min };
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════════
   GEOCODING (Nominatim)
   ═══════════════════════════════════════════════ */
async function geocode(query) {
  // Se limita a Ibagué (viewbox) y se añade la ciudad si no viene en el texto
  const q = /ibagu/i.test(query) ? query : `${query}, Ibagué, Tolima`;
  const url =
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}` +
    `&format=json&limit=1&countrycodes=co&viewbox=-75.35,4.50,-75.10,4.35&bounded=1`;
  const res = await fetch(url, { headers: { "Accept-Language": "es" } });
  const data = await res.json();
  if (data.length === 0) throw new Error("Dirección no encontrada en Ibagué");
  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    display: data[0].display_name,
  };
}


/* ═══════════════════════════════════════════════
   UI HELPERS
   ═══════════════════════════════════════════════ */
function showCoordRow(show) {
  document.getElementById("coordsRow").style.display = show ? "flex" : "none";
}

function updateCounters() {
  document.getElementById("counterPedidos").textContent =
    `${App.empresa.pedidos.length} paquete${App.empresa.pedidos.length !== 1 ? "s" : ""}`;
  document.getElementById("counterVehiculos").textContent =
    `${App.empresa.vehiculos.length} vehículo${App.empresa.vehiculos.length !== 1 ? "s" : ""}`;
}

function renderPedidosList() {
  const list = document.getElementById("pedidosList");
  const actions = document.getElementById("pedidoActions");

  if (App.empresa.pedidos.length === 0) {
    list.innerHTML = '<div class="empty-state">Sin paquetes registrados</div>';
    actions.style.display = "none";
    return;
  }

  actions.style.display = "flex";
  list.innerHTML = App.empresa.pedidos
    .map(
      (p) => `
    <div class="pedido-item" id="pitem-${p.id}">
      <span class="pedido-num">${p.icono}</span>
      <div class="pedido-info">
        <div class="pedido-addr" title="${p.direccion}">${p.codigo} · ${p.direccion}</div>
        <div class="pedido-meta">${p.peso} kg · ${p.dimsCm} · ${p.tipo}</div>
      </div>
      <span class="pedido-badge badge-${p.prioridad}">${p.prioridad}</span>
      <button class="pedido-del" data-id="${p.id}" title="Eliminar">✕</button>
    </div>
  `,
    )
    .join("");

  list.querySelectorAll(".pedido-del").forEach((btn) => {
    btn.addEventListener("click", () => eliminarPedido(parseInt(btn.dataset.id)));
  });
}

function renderVehiculos() {
  const grid = document.getElementById("vehiculosGrid");
  const sel = document.getElementById("selectVehiculosUso");
  if (sel) {
    const actual = sel.value;
    sel.innerHTML =
      '<option value="todos">Toda la flota (más grande primero)</option>' +
      App.empresa.vehiculos
        .map((v) => `<option value="${v.id}">${v.icon} ${v.tipo} #${v.id} — ${v.capVolumen.toFixed(1)} m³</option>`)
        .join("");
    sel.value = [...sel.options].some((o) => o.value === actual) ? actual : "todos";
  }
  if (App.empresa.vehiculos.length === 0) {
    grid.innerHTML = '<div class="empty-state">Sin vehículos en flota</div>';
    return;
  }
  grid.innerHTML = App.empresa.vehiculos
    .map(
      (v) => `
    <div class="vehiculo-card disponible">
      <span class="vehiculo-icon">${v.icon}</span>
      <div class="vehiculo-info">
        <div class="vehiculo-name">${v.tipo} #${v.id}</div>
        <div class="vehiculo-specs">
          📐 ${v.dimsTxt} (${v.capVolumen.toFixed(2)} m³)<br>
          ⚖️ ${v.capPeso} kg · ⛽ ${v.consumo} L/100km · 🚗 ${v.speed} km/h
        </div>
      </div>
      <button class="vehiculo-del" data-id="${v.id}" title="Eliminar">✕</button>
    </div>
  `,
    )
    .join("");

  grid.querySelectorAll(".vehiculo-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      App.empresa.eliminarVehiculo(parseInt(btn.dataset.id));
      renderVehiculos();
      updateCounters();
      showToast("Vehículo eliminado", "info");
    });
  });
}

function renderResultados(rutas) {
  const container = document.getElementById("resultadoRutas");
  if (rutas.length === 0) {
    container.innerHTML = '<div class="empty-state">Sin rutas generadas</div>';
    return;
  }

  rutas.forEach((r, i) => (r._idx = i));
  container.innerHTML = rutas
    .map((r, i) => {
      const metodo = r.metodo === "backtracking" ? "BT" : r.metodo === "2-opt" ? "NN+2opt" : "Voraz";
      const badgeClass = r.metodo === "voraz" ? "badge-gr" : "badge-bt";
      const volPct = r.cargaVolumenRatio * 100;
      const pesoPct = r.cargaPesoRatio * 100;
      const paradasHtml = r.paradas
        .map(
          (p) =>
            `<div class="parada-row"><span class="parada-n">${p.n}</span><span>${p.parada.paquetes
              .map((q) => `${q.icono}${q.codigo}`)
              .join(" ")}</span></div>`,
        )
        .join("");

      return `
      <div class="ruta-card">
        <div class="ruta-card-header">
          <span class="ruta-title">${r.vehiculo.icon} Ruta ${i + 1} — ${r.vehiculo.tipo} #${r.vehiculo.id}</span>
          <span class="ruta-badge-algo ${badgeClass}">${metodo}</span>
        </div>
        <div class="ruta-metrics">
          <span class="ruta-metric">📦 <strong>${r.pedidos.length} paquetes</strong> en ${r.paradas.length} paradas</span>
        </div>
        <div class="carga-bars">
          <div class="carga-bar"><span>Volumen ${r.volumenTotal.toFixed(2)}/${r.vehiculo.capVolumen.toFixed(2)} m³</span>
            <div class="bar"><div class="bar-fill" style="width:${Math.min(volPct, 100)}%"></div></div><b>${volPct.toFixed(0)}%</b></div>
          <div class="carga-bar"><span>Peso ${r.pesoTotal.toFixed(0)}/${r.vehiculo.capPeso} kg</span>
            <div class="bar"><div class="bar-fill peso" style="width:${Math.min(pesoPct, 100)}%"></div></div><b>${pesoPct.toFixed(0)}%</b></div>
        </div>
        <div class="ruta-metrics">
          <span class="ruta-metric">📏 <strong>${r.distKm.toFixed(2)} km</strong></span>
          <span class="ruta-metric">⏱️ <strong>${Math.round(r.timeMin)} min</strong></span>
          <span class="ruta-metric">⛽ <strong>${r.fuelL.toFixed(2)} L</strong></span>
        </div>
        ${
          r.btData && r.greedyData
            ? `
        <div class="ruta-metrics" style="margin-top:6px; padding-top:6px; border-top:1px solid var(--border)">
          <span class="ruta-metric">${metodo}: <strong>${r.btData.cost.toFixed(2)}km</strong></span>
          <span class="ruta-metric">Voraz: <strong>${r.greedyData.cost.toFixed(2)}km</strong></span>
          <span class="ruta-metric" style="color:var(--green)">
            Mejora: <strong>${((1 - r.btData.cost / r.greedyData.cost) * 100).toFixed(1)}%</strong>
          </span>
        </div>`
            : ""
        }
        <div class="ruta-metrics via-line" id="via-${i}"><span class="ruta-metric">🛣️ Calculando ruta por calles…</span></div>
        <details class="paradas-det"><summary>Orden de entrega (${r.paradas.length} paradas)</summary>${paradasHtml}</details>
        <div class="ruta-btns">
          <button class="show-route-btn" data-route="${i}">👁 Ver en mapa</button>
          <button class="show-route-btn" data-carga="${i}">🧊 Ver carga</button>
        </div>
      </div>
    `;
    })
    .join("");

  container.querySelectorAll("[data-route]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.route);
      clearRouteLines();
      drawRoute(rutas[idx], ROUTE_COLORS[idx % ROUTE_COLORS.length]);
      showToast(`Mostrando Ruta ${idx + 1}`, "success");
    });
  });
  container.querySelectorAll("[data-carga]").forEach((btn) => {
    btn.addEventListener("click", () => mostrarCarga(rutas[parseInt(btn.dataset.carga)], parseInt(btn.dataset.carga)));
  });
}

const ROUTE_COLORS = ["#f5a623", "#3b82f6", "#22c55e", "#a855f7", "#ef4444", "#14b8a6"];

function renderNoAsignados(lista) {
  const box = document.getElementById("noAsignados");
  if (!lista || lista.length === 0) {
    box.style.display = "none";
    return;
  }
  box.style.display = "block";
  box.innerHTML =
    `<b>⚠️ ${lista.length} paquete(s) sin entregar</b> (no caben en ningún vehículo de la flota):<br>` +
    lista.map((p) => `${p.icono} ${p.codigo} — ${p.peso} kg · ${p.dimsCm}`).join("<br>");
}

/* ═══════════════════════════════════════════════
   VISTA DE CARGA — planta y perfil del espacio del vehículo
   x = ancho · y = alto (vertical) · z = profundidad (puerta abajo/izq → fondo)
   Color = orden de entrega (la parada 1 y la última se distinguen por tono).
   ═══════════════════════════════════════════════ */
function mostrarCarga(ruta, idx) {
  const v = ruta.vehiculo;
  const nParadas = ruta.paradas.length;
  const ordenDeParada = new Map();
  ruta.paradas.forEach((p) => p.parada.paquetes.forEach((q) => ordenDeParada.set(q.id, p.n)));
  const color = (id) => `hsl(${Math.round(((ordenDeParada.get(id) - 1) / Math.max(nParadas, 1)) * 300)} 70% 55%)`;

  const ESC = 420 / Math.max(v.ancho, v.profundidad);
  // PLANTA: horizontal = ancho (x), vertical = profundidad (z)
  const pw = v.ancho * ESC,
    ph = v.profundidad * ESC;
  const capas = [...ruta.carga].sort((a, b) => a.y - b.y);
  const planta = capas
    .map(
      (c) =>
        `<rect x="${c.x * ESC}" y="${c.z * ESC}" width="${c.w * ESC}" height="${c.d * ESC}" fill="${color(c.id)}" fill-opacity="0.55" stroke="#000" stroke-opacity=".5" stroke-width="0.6"><title>${c.pedido.codigo} · ${c.pedido.tipo} · parada ${ordenDeParada.get(c.id)}\n${Math.round(c.w * 100)}×${Math.round(c.h * 100)}×${Math.round(c.d * 100)} cm · y=${(c.y * 100).toFixed(0)} cm</title></rect>`,
    )
    .join("");
  // PERFIL: horizontal = profundidad (z), vertical = alto (y, hacia arriba)
  const sw = v.profundidad * ESC,
    sh = v.alto * ESC;
  const perfil = capas
    .map(
      (c) =>
        `<rect x="${c.z * ESC}" y="${sh - (c.y + c.h) * ESC}" width="${c.d * ESC}" height="${c.h * ESC}" fill="${color(c.id)}" fill-opacity="0.55" stroke="#000" stroke-opacity=".5" stroke-width="0.6"><title>${c.pedido.codigo}</title></rect>`,
    )
    .join("");

  document.getElementById("modalCargaTitulo").textContent =
    `${v.icon} ${v.tipo} #${v.id} — Ruta ${idx + 1} · ${ruta.carga.length} paquetes`;
  document.getElementById("modalCargaBody").innerHTML = `
    <div class="carga-info">
      Espacio: <b>${v.dimsTxt}</b> (${v.capVolumen.toFixed(2)} m³) · Ocupación volumen <b>${(ruta.cargaVolumenRatio * 100).toFixed(0)}%</b> ·
      peso <b>${ruta.pesoTotal.toFixed(0)}/${v.capPeso} kg</b>
    </div>
    <div class="carga-views">
      <div><div class="carga-cap">Vista de planta (ancho × profundidad)</div>
        <svg viewBox="-2 -2 ${pw + 4} ${ph + 4}" width="${pw + 4}" height="${ph + 4}"><rect x="0" y="0" width="${pw}" height="${ph}" fill="none" stroke="#8890a4" stroke-width="1.5"/>${planta}</svg>
        <div class="carga-cap">↑ fondo · ↓ puerta</div></div>
      <div><div class="carga-cap">Vista lateral (profundidad × alto)</div>
        <svg viewBox="-2 -2 ${sw + 4} ${sh + 4}" width="${sw + 4}" height="${sh + 4}"><rect x="0" y="0" width="${sw}" height="${sh}" fill="none" stroke="#8890a4" stroke-width="1.5"/>${perfil}</svg>
        <div class="carga-cap">← puerta · fondo →</div></div>
    </div>
    <div class="carga-cap">Color = orden de entrega (rojo = primeras paradas … violeta = últimas). Pasa el cursor sobre un paquete para ver detalle.</div>
    <div class="carga-nota">Nota: la carga se calcula por capacidad y geometría; para descargar sin mover paquetes conviene cargar primero lo que se entrega al final.</div>`;
  document.getElementById("modalCarga").style.display = "flex";
}

function renderStats(stats) {
  if (!stats) return;
  document.getElementById("statDistancia").textContent = `${stats.distTotal.toFixed(1)} km`;
  document.getElementById("statTiempo").textContent = `${Math.round(stats.timeTotal)} min`;
  document.getElementById("statCombustible").textContent = `${stats.fuelTotal.toFixed(1)} L`;
  document.getElementById("statViajes").textContent = stats.viajes;
  document.getElementById("statCosto").textContent = `$${Math.round(stats.costoTotal).toLocaleString("es-CO")}`;
  document.getElementById("statAhorro").textContent = `${stats.ahorroDist.toFixed(1)} km`;
  document.getElementById("statPaquetes").textContent = `${stats.pedidosAsignados}/${stats.pedidosTotal}`;
  document.getElementById("statOcupacion").textContent = `${(stats.ocupacionVol * 100).toFixed(0)}%`;

  if (stats.comparison) {
    const panel = document.getElementById("comparisonPanel");
    const table = document.getElementById("comparisonTable");
    panel.style.display = "block";
    const btBetter = stats.comparison.btCost <= stats.comparison.greedyCost;
    table.innerHTML = `
      <div class="ct-row header"><span>Métrica</span><span>BT / 2-opt</span><span>Voraz</span></div>
      <div class="ct-row">
        <span>Distancia</span>
        <span class="${btBetter ? "ct-winner" : ""}">${stats.comparison.btCost.toFixed(2)} km</span>
        <span class="${!btBetter ? "ct-winner" : ""}">${stats.comparison.greedyCost.toFixed(2)} km</span>
      </div>
      <div class="ct-row">
        <span>Iteraciones</span>
        <span>${stats.comparison.btIterations ? stats.comparison.btIterations.toLocaleString() : "2-opt"}</span>
        <span>1 (greedy)</span>
      </div>
      <div class="ct-row">
        <span>Calidad</span>
        <span>${btBetter ? "✅ Mejor" : "—"}</span>
        <span>${!btBetter ? "✅ Mejor" : "Aproximado"}</span>
      </div>
    `;
  }
}

function renderLog(log) {
  const content = document.getElementById("logContent");
  if (log.length === 0) {
    content.innerHTML = '<span class="log-empty">Sin log disponible.</span>';
    return;
  }
  content.innerHTML = log
    .map((line) => {
      let cls = "log-line";
      if (line.startsWith("[BT]")) cls += " warn";
      else if (line.startsWith("[Knapsack]") || line.startsWith("[D&C]"))
        cls += " info";
      else if (line.includes("completada") || line.includes("creadas"))
        cls += " success";
      else if (
        line.startsWith("[CVRP]") ||
        line.startsWith("[EmpresaLogistica]")
      )
        cls += " section";
      return `<div class="${cls}">${line}</div>`;
    })
    .join("");
  content.scrollTop = content.scrollHeight;
}

/* ═══════════════════════════════════════════════
   PROGRESS BAR
   ═══════════════════════════════════════════════ */
function showProgress(visible, pct = 0, label = "") {
  const bar = document.getElementById("progressBar");
  bar.style.display = visible ? "block" : "none";
  document.getElementById("progressFill").style.width = `${pct}%`;
  document.getElementById("progressLabel").textContent = label;
}

async function animateProgress(steps) {
  for (const [pct, label] of steps) {
    showProgress(true, pct, label);
    await new Promise((r) => setTimeout(r, 120));
  }
}

/* ═══════════════════════════════════════════════
   ACTIONS
   ═══════════════════════════════════════════════ */
async function agregarPedido() {
  const direccion = document.getElementById("inputDireccion").value.trim();
  const tipo = document.getElementById("inputTipo").value;
  const peso = parseFloat(document.getElementById("inputPeso").value);
  const alto = parseFloat(document.getElementById("inputAlto").value);
  const ancho = parseFloat(document.getElementById("inputAncho").value);
  const prof = parseFloat(document.getElementById("inputProf").value);
  const prioridad = document.querySelector('input[name="prioridad"]:checked')?.value || "media";
  let lat = parseFloat(document.getElementById("inputLat").value);
  let lng = parseFloat(document.getElementById("inputLng").value);

  if (!(peso > 0) || !(alto > 0) || !(ancho > 0) || !(prof > 0)) {
    showToast("Peso, alto, ancho y profundidad deben ser > 0", "error");
    return;
  }

  if (!lat || !lng) {
    if (!direccion) {
      showToast("Ingresa una dirección o haz clic en el mapa", "error");
      return;
    }
    setStatus("Geocodificando...");
    try {
      const geo = await geocode(direccion);
      lat = geo.lat;
      lng = geo.lng;
      showToast(`📍 ${geo.display.substring(0, 60)}...`, "success");
    } catch {
      showToast("No se pudo geocodificar. Haz clic en el mapa o ingresa coordenadas.", "error");
      setStatus("Sistema listo");
      return;
    }
    setStatus("Sistema listo");
  }

  try {
    const pedido = App.empresa.agregarPedido({
      direccion,
      lat,
      lng,
      peso,
      alto: alto / 100, // cm → m
      ancho: ancho / 100,
      profundidad: prof / 100,
      tipo,
      prioridad,
    });
    placeOrderMarker(pedido);
    App.map.panTo([lat, lng]);
    renderPedidosList();
    updateCounters();
    showToast(`Paquete ${pedido.codigo} agregado`, "success");
    ["inputDireccion", "inputLat", "inputLng", "inputPeso", "inputAlto", "inputAncho", "inputProf"].forEach(
      (id) => (document.getElementById(id).value = ""),
    );
    showCoordRow(false);
  } catch (e) {
    showToast(e.message, "error");
  }
}

function eliminarPedido(id) {
  App.empresa.eliminarPedido(id);
  removeOrderMarker(id);
  renderPedidosList();
  updateCounters();
  showToast(`Paquete eliminado`, "info");
}

function limpiarPedidos() {
  App.empresa.limpiarPedidos();
  App.markers.orders.forEach((m) => m.marker.remove());
  App.markers.orders = [];
  clearRouteLines();
  renderPedidosList();
  updateCounters();
  document.getElementById("resultadoRutas").innerHTML = "";
  renderNoAsignados([]);
  showToast("Paquetes eliminados", "info");
}

function cargarPedidosDesdeTexto(texto, origen = "CSV") {
  const { pedidos, errores } = pedidosDesdeCSV(texto);
  limpiarPedidos();
  pedidos.forEach((d) => {
    const pedido = App.empresa.agregarPedido(d);
    placeOrderMarker(pedido);
  });
  renderPedidosList();
  updateCounters();
  if (pedidos.length) App.map.setView([IBAGUE.lat, IBAGUE.lng], 13);

  const vol = App.empresa.pedidos.reduce((s, p) => s + p.volumen, 0);
  const kg = App.empresa.pedidos.reduce((s, p) => s + p.peso, 0);
  const rep = document.getElementById("csvReport");
  rep.className = "csv-report " + (errores.length ? "warn" : "ok");
  rep.innerHTML =
    `✅ ${pedidos.length} paquetes cargados (${origen}) · ${vol.toFixed(2)} m³ · ${kg.toFixed(0)} kg` +
    (errores.length
      ? `<br>⚠️ ${errores.length} fila(s) omitidas:<br>` + errores.slice(0, 6).join("<br>") + (errores.length > 6 ? "<br>…" : "")
      : "");
  showToast(`${pedidos.length} paquetes cargados`, errores.length ? "info" : "success");
}

function cargarDemo() {
  cargarPedidosDesdeTexto(DEMO_CSV_IBAGUE, "demo Ibagué");
}

function descargarPlantilla() {
  const blob = new Blob(["\uFEFF" + DEMO_CSV_IBAGUE], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "paquetes_ibague.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function optimizar() {
  if (App.empresa.pedidos.length === 0) {
    showToast("Agrega paquetes primero", "error");
    return;
  }
  if (App.empresa.vehiculos.length === 0) {
    showToast("Agrega vehículos primero", "error");
    return;
  }

  const algoritmo = document.querySelector('input[name="algoritmo"]:checked')?.value || "backtracking";
  const depositoLat = parseFloat(document.getElementById("depositoLat").value);
  const depositoLng = parseFloat(document.getElementById("depositoLng").value);
  const precioCombustible = parseFloat(document.getElementById("inputPrecioCombustible").value) || 4000;
  const uso = document.getElementById("selectVehiculosUso").value;
  const vehiculos =
    uso === "todos" ? App.empresa.vehiculos : App.empresa.vehiculos.filter((v) => String(v.id) === uso);

  if (!isNaN(depositoLat) && !isNaN(depositoLng)) {
    App.empresa.setDeposito(depositoLat, depositoLng);
    placeDepotMarker(depositoLat, depositoLng);
  }
  App.empresa.precioCombustible = precioCombustible;

  document.getElementById("btnOptimizar").disabled = true;
  clearRouteLines();

  await animateProgress([
    [15, "Construyendo matriz de distancias..."],
    [30, "Dijkstra y Kruskal (MST)..."],
    [50, "Knapsack DP: qué paquetes caben (peso + volumen)..."],
    [70, "Empaquetado 3D en el vehículo..."],
    [85, algoritmo === "voraz" ? "Algoritmo Voraz..." : "Backtracking / 2-opt sobre las paradas..."],
    [95, "Generando rutas..."],
  ]);

  try {
    await new Promise((resolve) =>
      setTimeout(async () => {
        try {
          const rutas = App.empresa.optimizar(algoritmo, vehiculos);
          showProgress(true, 100, "Completado");
          await new Promise((r) => setTimeout(r, 400));
          showProgress(false);

          rutas.forEach((ruta, i) => drawRoute(ruta, ROUTE_COLORS[i % ROUTE_COLORS.length]));
          renderResultados(rutas);
          renderNoAsignados(App.empresa.noAsignados);
          renderStats(App.empresa.getStats());
          renderLog(App.empresa.log);

          showToast(`✅ ${rutas.length} ruta${rutas.length !== 1 ? "s" : ""} optimizada${rutas.length !== 1 ? "s" : ""}`, "success");
          setStatus(`${rutas.length} rutas activas`);
        } catch (e) {
          showProgress(false);
          showToast(e.message, "error");
          setStatus("Error en optimización");
        }
        resolve();
      }, 50),
    );
  } finally {
    document.getElementById("btnOptimizar").disabled = false;
  }
}

/* ═══════════════════════════════════════════════
   GEOCODE DEPOSIT
   ═══════════════════════════════════════════════ */
async function geocodeDeposito() {
  const q = document.getElementById("inputDepositoAddr").value.trim();
  if (!q) return;
  setStatus("Geocodificando depósito...");
  try {
    const geo = await geocode(q);
    document.getElementById("depositoLat").value = geo.lat.toFixed(5);
    document.getElementById("depositoLng").value = geo.lng.toFixed(5);
    placeDepotMarker(geo.lat, geo.lng);
    App.map.panTo([geo.lat, geo.lng]);
    showToast("Depósito actualizado", "success");
  } catch {
    showToast("No se encontró la dirección del depósito", "error");
  }
  setStatus("Sistema listo");
}

/* ═══════════════════════════════════════════════
   DEFAULT VEHICLES
   ═══════════════════════════════════════════════ */
function initDefaultVehiculos() {
  // Valores de referencia en models.js (espacio de carga y capacidad por tipo)
  App.empresa.agregarVehiculo({ tipo: "camion" });
  App.empresa.agregarVehiculo({ tipo: "van" });
  App.empresa.agregarVehiculo({ tipo: "moto" });
  renderVehiculos();
  updateCounters();
}

/* ═══════════════════════════════════════════════
   EVENT LISTENERS
   ═══════════════════════════════════════════════ */
function bindEvents() {
  // Nav
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".nav-btn")
        .forEach((b) => b.classList.remove("active"));
      document
        .querySelectorAll(".panel")
        .forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const panelId = `panel-${btn.dataset.panel}`;
      document.getElementById(panelId)?.classList.add("active");
      App.currentPanel = btn.dataset.panel;
    });
  });

  // Pedidos
  document
    .getElementById("btnAgregarPedido")
    .addEventListener("click", agregarPedido);
  document.getElementById("inputDireccion").addEventListener("keydown", (e) => {
    if (e.key === "Enter") agregarPedido();
  });
  document.getElementById("btnGeocode").addEventListener("click", async () => {
    const q = document.getElementById("inputDireccion").value.trim();
    if (!q) return;
    setStatus("Geocodificando...");
    try {
      const geo = await geocode(q);
      document.getElementById("inputLat").value = geo.lat.toFixed(5);
      document.getElementById("inputLng").value = geo.lng.toFixed(5);
      showCoordRow(true);
      App.map.panTo([geo.lat, geo.lng]);
      showToast(`📍 Ubicación encontrada`, "success");
    } catch {
      showToast("No se encontró la dirección", "error");
    }
    setStatus("Sistema listo");
  });
  document.getElementById("btnToggleCoords").addEventListener("click", () => {
    const row = document.getElementById("coordsRow");
    const visible = row.style.display !== "none";
    showCoordRow(!visible);
    document.getElementById("btnToggleCoords").textContent = visible
      ? "Ingresar coordenadas manualmente"
      : "Ocultar coordenadas";
  });
  document
    .getElementById("btnLimpiarPedidos")
    .addEventListener("click", limpiarPedidos);
  document.getElementById("btnDemoData").addEventListener("click", cargarDemo);
  document.getElementById("btnDemoIbague").addEventListener("click", cargarDemo);
  document.getElementById("btnPlantillaCSV").addEventListener("click", descargarPlantilla);
  document.getElementById("btnImportCSV").addEventListener("click", () => document.getElementById("fileCSV").click());
  document.getElementById("fileCSV").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    cargarPedidosDesdeTexto(await f.text(), f.name);
    e.target.value = "";
  });
  document.getElementById("btnCerrarModal").addEventListener("click", () => (document.getElementById("modalCarga").style.display = "none"));
  document.getElementById("modalCarga").addEventListener("click", (e) => {
    if (e.target.id === "modalCarga") e.target.style.display = "none";
  });

  // Vehículos
  document
    .getElementById("btnAgregarVehiculo")
    .addEventListener("click", () => {
      const tipo = document.getElementById("selectTipoVehiculo").value;
      const capPeso = parseFloat(document.getElementById("vCapPeso").value);
      const ancho = parseFloat(document.getElementById("vAncho").value);
      const alto = parseFloat(document.getElementById("vAlto").value);
      const prof = parseFloat(document.getElementById("vProf").value);
      const consumo = parseFloat(document.getElementById("vConsumo").value);
      try {
        const v = App.empresa.agregarVehiculo({
          tipo,
          capPeso,
          ancho,
          alto,
          profundidad: prof,
          consumo,
        });
        renderVehiculos();
        updateCounters();
        showToast(`${v.icon} ${v.tipo} #${v.id} agregado`, "success");
      } catch (e) {
        showToast(e.message, "error");
      }
    });

  // Rutas
  document.getElementById("btnOptimizar").addEventListener("click", optimizar);
  document
    .getElementById("btnGeocodeDeposito")
    .addEventListener("click", geocodeDeposito);

  // Map controls
  document.getElementById("btnCenterMap").addEventListener("click", () => {
    App.map.setView([IBAGUE.lat, IBAGUE.lng], 13);
  });
  document.getElementById("btnClearRoutes").addEventListener("click", () => {
    clearRouteLines();
    document.getElementById("resultadoRutas").innerHTML = "";
    showToast("Rutas limpiadas", "info");
  });
}

/* ═══════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initDefaultVehiculos();
  bindEvents();
  renderPedidosList();
  setStatus("Sistema listo");
  showToast(
    "RouteForge Ibagué — importa un CSV o haz clic en el mapa",
    "info",
    4000,
  );
});