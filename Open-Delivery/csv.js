/**
 * csv.js — Lectura de paquetes desde CSV
 * Columnas (el orden no importa, acepta , o ;):
 *   id, direccion, tipo (sobre|caja), peso_kg, alto_cm, ancho_cm,
 *   profundidad_cm, lat, lon, prioridad (alta|media|baja, opcional)
 * Peso en kg y medidas en cm. Si el encabezado termina en _m, la medida va en metros.
 */
"use strict";

const CSV_COLUMNAS = "id,direccion,tipo,peso_kg,alto_cm,ancho_cm,profundidad_cm,lat,lon,prioridad";

function _norm(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_");
}

// Parser CSV con comillas; detecta separador , o ;
function parseCSV(texto) {
  texto = texto.replace(/^\uFEFF/, "");
  const primera = texto.split(/\r?\n/, 1)[0] || "";
  const sep = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ";" : ",";
  const filas = [];
  let fila = [],
    campo = "",
    enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') enComillas = false;
      else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === sep) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      campo = "";
      if (fila.some((x) => x.trim() !== "")) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x.trim() !== "")) filas.push(fila);
  return filas;
}

const _num = (v) => parseFloat(String(v ?? "").trim().replace(",", "."));

/**
 * Convierte el texto CSV en datos de pedidos.
 * Devuelve { pedidos: [...], errores: ["Fila 5: ...", ...] }
 */
function pedidosDesdeCSV(texto) {
  const filas = parseCSV(texto);
  if (filas.length < 2) return { pedidos: [], errores: ["El CSV está vacío o sin filas de datos"] };

  const encabezados = filas[0].map(_norm);
  const buscar = (...alias) => encabezados.findIndex((h) => alias.some((a) => h === a || h.startsWith(a + "_")));
  const col = {
    id: buscar("id", "codigo"),
    direccion: buscar("direccion", "barrio", "destino"),
    tipo: buscar("tipo"),
    peso: buscar("peso"),
    alto: buscar("alto"),
    ancho: buscar("ancho"),
    prof: buscar("profundidad", "prof", "largo", "fondo"),
    lat: buscar("lat", "latitud"),
    lon: buscar("lon", "lng", "longitud"),
    prioridad: buscar("prioridad"),
  };
  const faltan = ["peso", "alto", "ancho", "prof", "lat", "lon"].filter((k) => col[k] < 0);
  if (faltan.length)
    return { pedidos: [], errores: [`Faltan columnas: ${faltan.join(", ")}. Esperadas: ${CSV_COLUMNAS}`] };

  // factor a metros según el sufijo del encabezado (por defecto cm)
  const aMetros = (k) => (encabezados[col[k]].endsWith("_m") ? 1 : 0.01);
  const pedidos = [],
    errores = [];

  filas.slice(1).forEach((f, i) => {
    const n = i + 2;
    const tipo = col.tipo >= 0 ? _norm(f[col.tipo] || "caja") : "caja";
    const prioridad = col.prioridad >= 0 ? _norm(f[col.prioridad] || "media") : "media";
    const p = {
      codigo: col.id >= 0 ? (f[col.id] || "").trim() || null : null,
      direccion: col.direccion >= 0 ? (f[col.direccion] || "").trim() : "",
      tipo,
      peso: _num(f[col.peso]),
      alto: _num(f[col.alto]) * aMetros("alto"),
      ancho: _num(f[col.ancho]) * aMetros("ancho"),
      profundidad: _num(f[col.prof]) * aMetros("prof"),
      lat: _num(f[col.lat]),
      lng: _num(f[col.lon]),
      prioridad: ["alta", "media", "baja"].includes(prioridad) ? prioridad : "media",
    };
    if (!["sobre", "caja"].includes(tipo)) errores.push(`Fila ${n}: tipo "${f[col.tipo]}" no válido (sobre o caja)`);
    else if (!(p.peso > 0) || !(p.alto > 0) || !(p.ancho > 0) || !(p.profundidad > 0))
      errores.push(`Fila ${n}: peso y medidas deben ser números > 0`);
    else if (isNaN(p.lat) || isNaN(p.lng)) errores.push(`Fila ${n}: lat/lon inválidos`);
    else if (p.lat < 4.2 || p.lat > 4.7 || p.lng < -75.45 || p.lng > -75.0)
      errores.push(`Fila ${n}: (${p.lat}, ${p.lng}) queda fuera de Ibagué`);
    else pedidos.push(p);
  });
  return { pedidos, errores };
}
