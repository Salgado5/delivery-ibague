/**
 * models.js — RouteForge POO Classes
 * Clases: Pedido, Vehiculo, Ruta, EmpresaLogistica (Ibagué, Tolima)
 */

"use strict";

/* ═══════════════════════════════════════════════
   CLASS: Pedido (paquete)
   Dimensiones en METROS internamente (la UI/CSV las recibe en cm).
   tipo: "sobre" (plano, se acuesta) | "caja"
   ═══════════════════════════════════════════════ */
const DEPOSITO_IBAGUE = { lat: 4.4350, lng: -75.2200 }; // centro de distribución (editable)

class Pedido {
  static #counter = 0;
  static TIPOS = ["sobre", "caja"];

  constructor({
    codigo = null,
    direccion,
    lat,
    lng,
    peso,
    alto,
    ancho,
    profundidad,
    tipo = "caja",
    prioridad = "media",
  }) {
    peso = parseFloat(peso);
    alto = parseFloat(alto);
    ancho = parseFloat(ancho);
    profundidad = parseFloat(profundidad);
    lat = parseFloat(lat);
    lng = parseFloat(lng);
    if (!(peso > 0)) throw new Error("El peso debe ser > 0");
    if (!(alto > 0 && ancho > 0 && profundidad > 0))
      throw new Error("Alto, ancho y profundidad deben ser > 0");
    if (!Pedido.TIPOS.includes(tipo))
      throw new Error(`Tipo inválido "${tipo}" (use sobre o caja)`);
    if (isNaN(lat) || isNaN(lng)) throw new Error("Coordenadas requeridas");

    this.id = ++Pedido.#counter;
    this.codigo = codigo || `P${String(this.id).padStart(3, "0")}`;
    this.direccion = direccion || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    this.lat = lat;
    this.lng = lng;
    this.peso = peso; // kg
    this.alto = alto; // m
    this.ancho = ancho; // m
    this.profundidad = profundidad; // m
    this.tipo = tipo;
    this.prioridad = prioridad;
    this.createdAt = new Date();
  }

  get volumen() {
    return this.ancho * this.alto * this.profundidad; // m³
  }

  get dimsCm() {
    return `${Math.round(this.ancho * 100)}×${Math.round(this.alto * 100)}×${Math.round(this.profundidad * 100)} cm`;
  }

  get icono() {
    return this.tipo === "sobre" ? "✉️" : "📦";
  }

  toPoint() {
    return { lat: this.lat, lng: this.lng };
  }

  toString() {
    return `${this.codigo} [${this.tipo}/${this.prioridad}] ${this.direccion} | ${this.peso}kg · ${this.dimsCm}`;
  }

  static resetCounter() {
    Pedido.#counter = 0;
  }
}

/* ═══════════════════════════════════════════════
   CLASS: Vehiculo
   Espacio de carga = caja ancho × alto × profundidad (m) + capacidad de peso.
   ═══════════════════════════════════════════════ */
class Vehiculo {
  static #DEFAULTS = {
    // Valores de referencia del espacio de carga útil
    moto: {
      capPeso: 25, ancho: 0.4, alto: 0.4, profundidad: 0.45,
      consumo: 2.5, icon: "🏍️", speed: 30, // baúl de moto de reparto
    },
    van: {
      capPeso: 800, ancho: 1.5, alto: 1.3, profundidad: 2.5,
      consumo: 9.0, icon: "🚐", speed: 35, // tipo Renault Kangoo / Hyundai H1 de carga
    },
    camion: {
      capPeso: 3500, ancho: 2.1, alto: 2.1, profundidad: 4.5,
      consumo: 18.0, icon: "🚚", speed: 30, // tipo Chevrolet NHR/NPR (furgón)
    },
  };
  static #counter = 0;

  constructor({ tipo, capPeso, ancho, alto, profundidad, consumo }) {
    const d = Vehiculo.#DEFAULTS[tipo];
    if (!d) throw new Error(`Tipo de vehículo desconocido: ${tipo}`);
    this.id = ++Vehiculo.#counter;
    this.tipo = tipo;
    this.capPeso = parseFloat(capPeso) || d.capPeso; // kg
    this.ancho = parseFloat(ancho) || d.ancho; // m
    this.alto = parseFloat(alto) || d.alto; // m
    this.profundidad = parseFloat(profundidad) || d.profundidad; // m
    this.consumo = parseFloat(consumo) || d.consumo; // L/100km
    this.icon = d.icon;
    this.speed = d.speed; // km/h promedio urbano
  }

  get capVolumen() {
    return this.ancho * this.alto * this.profundidad; // m³
  }

  get dimsTxt() {
    return `${this.ancho}×${this.alto}×${this.profundidad} m`;
  }

  calcFuel(distKm) {
    return distKm * (this.consumo / 100);
  }

  calcTime(distKm) {
    return (distKm / this.speed) * 60; // minutos
  }

  toString() {
    return `${this.icon} ${this.tipo.toUpperCase()} #${this.id} | ${this.capPeso}kg / ${this.capVolumen.toFixed(2)}m³`;
  }

  static getDefaults() {
    return { ...Vehiculo.#DEFAULTS };
  }
  static resetCounter() {
    Vehiculo.#counter = 0;
  }
}

/* ═══════════════════════════════════════════════
   CLASS: Ruta
   ═══════════════════════════════════════════════ */
class Ruta {
  constructor({
    vehiculo,
    pedidos,
    puntos,
    distKm,
    algoritmo = "voraz",
    metodo = null,
    paradas = [],
    carga = [],
    btData = null,
    greedyData = null,
  }) {
    this.vehiculo = vehiculo;
    this.pedidos = pedidos; // en orden de entrega
    this.puntos = puntos; // [{lat, lng}, ...] depósito → paradas → depósito
    this.distKm = distKm;
    this.algoritmo = algoritmo;
    this.metodo = metodo; // backtracking | 2-opt | voraz
    this.paradas = paradas; // [{n, parada:{lat,lng,paquetes[]}}]
    this.carga = carga; // posiciones 3D de cada paquete en el vehículo
    this.btData = btData;
    this.greedyData = greedyData;
    this.calculadaEn = new Date();
  }

  get timeMin() {
    return this.vehiculo.calcTime(this.distKm);
  }
  get fuelL() {
    return this.vehiculo.calcFuel(this.distKm);
  }
  get pesoTotal() {
    return this.pedidos.reduce((s, p) => s + p.peso, 0);
  }
  get volumenTotal() {
    return this.pedidos.reduce((s, p) => s + p.volumen, 0);
  }
  get cargaPesoRatio() {
    return this.pesoTotal / this.vehiculo.capPeso;
  }
  get cargaVolumenRatio() {
    return this.volumenTotal / this.vehiculo.capVolumen;
  }

  summary() {
    return {
      vehiculo: this.vehiculo.toString(),
      paquetes: this.pedidos.length,
      paradas: this.paradas.length,
      distancia: `${this.distKm.toFixed(2)} km`,
      tiempo: `${Math.round(this.timeMin)} min`,
      combustible: `${this.fuelL.toFixed(2)} L`,
      pesoTotal: `${this.pesoTotal.toFixed(1)} kg`,
      ocupacionVolumen: `${(this.cargaVolumenRatio * 100).toFixed(0)}%`,
      algoritmo: this.metodo || this.algoritmo,
    };
  }

  toString() {
    return `Ruta [${this.vehiculo.tipo}] Depósito → ${this.paradas.map((p) => "P" + p.n).join(" → ")} → Depósito | ${this.distKm.toFixed(2)}km`;
  }
}

/* ═══════════════════════════════════════════════
   CLASS: EmpresaLogistica
   ═══════════════════════════════════════════════ */
class EmpresaLogistica {
  constructor(nombre = "RouteForge Logistics · Ibagué") {
    this.nombre = nombre;
    this.pedidos = [];
    this.vehiculos = [];
    this.rutas = [];
    this.deposito = { ...DEPOSITO_IBAGUE }; // Ibagué, Tolima
    this.noAsignados = [];
    this.precioCombustible = 4000; // COP por litro (valor de referencia, editable en la UI)
    this._log = [];
  }

  /* ── Pedidos ── */
  agregarPedido(data) {
    const p = new Pedido(data);
    this.pedidos.push(p);
    return p;
  }
  eliminarPedido(id) {
    this.pedidos = this.pedidos.filter((p) => p.id !== id);
  }
  limpiarPedidos() {
    this.pedidos = [];
    Pedido.resetCounter();
  }

  /* ── Vehículos ── */
  agregarVehiculo(data) {
    const v = new Vehiculo(data);
    this.vehiculos.push(v);
    return v;
  }
  eliminarVehiculo(id) {
    this.vehiculos = this.vehiculos.filter((v) => v.id !== id);
  }

  setDeposito(lat, lng) {
    this.deposito = { lat: parseFloat(lat), lng: parseFloat(lng) };
  }

  /* ── Optimización principal ── */
  optimizar(algoritmo = "backtracking", vehiculos = this.vehiculos) {
    this._log = [];
    if (this.pedidos.length === 0) throw new Error("Sin pedidos");
    if (vehiculos.length === 0) throw new Error("Sin vehículos");

    this._log.push(`[EmpresaLogistica] Iniciando optimización: ${algoritmo}`);
    this._log.push(
      `[EmpresaLogistica] Depósito: ${this.deposito.lat.toFixed(4)}, ${this.deposito.lng.toFixed(4)}`,
    );

    const rawResults = solveCVRP({
      depot: this.deposito,
      orders: this.pedidos,
      vehicles: vehiculos,
      algorithm: algoritmo,
      log: this._log,
    });

    this.noAsignados = rawResults.noAsignados || [];
    this.rutas = rawResults.map(
      (r) =>
        new Ruta({
          vehiculo: r.vehicle,
          pedidos: r.selectedOrders,
          puntos: r.routePoints,
          distKm: r.distKm,
          algoritmo: algoritmo === "ambos" ? "backtracking" : algoritmo,
          metodo: r.metodo,
          paradas: r.paradas,
          carga: r.carga,
          btData: r.btResult,
          greedyData: r.greedyResult,
        }),
    );

    this._log.push(`[EmpresaLogistica] ${this.rutas.length} rutas creadas`);
    return this.rutas;
  }

  /* ── Estadísticas globales ── */
  getStats(precioCombustible = this.precioCombustible) {
    if (this.rutas.length === 0) return null;
    const distTotal = this.rutas.reduce((s, r) => s + r.distKm, 0);
    const timeTotal = this.rutas.reduce((s, r) => s + r.timeMin, 0);
    const fuelTotal = this.rutas.reduce((s, r) => s + r.fuelL, 0);
    const costoTotal = fuelTotal * precioCombustible;

    // Naive: all vehicles go to each client individually
    const naiveDist = this.pedidos.reduce(
      (s, p) => s + 2 * haversine(this.deposito, p.toPoint()) * FACTOR_URBANO,
      0,
    );
    const naiveFuel = (naiveDist * (this.vehiculos[0]?.consumo || 8)) / 100;
    const ahorroDist = naiveDist - distTotal;
    const ahorroFuel = naiveFuel - fuelTotal;
    const ahorroMoney = ahorroFuel * precioCombustible;

    // Comparison data for 'ambos' mode
    let comparison = null;
    const rutaConComparacion = this.rutas.find((r) => r.btData && r.greedyData);
    if (rutaConComparacion) {
      comparison = {
        btCost: rutaConComparacion.btData.cost,
        greedyCost: rutaConComparacion.greedyData.cost,
        btIterations: rutaConComparacion.btData.iterations,
      };
    }

    return {
      distTotal,
      timeTotal,
      fuelTotal,
      costoTotal,
      viajes: this.rutas.length,
      pedidosAsignados: this.rutas.reduce((s, r) => s + r.pedidos.length, 0),
      pedidosTotal: this.pedidos.length,
      noAsignados: this.noAsignados.length,
      ocupacionVol:
        this.rutas.reduce((s, r) => s + r.volumenTotal, 0) /
        this.rutas.reduce((s, r) => s + r.vehiculo.capVolumen, 0),
      ahorroDist,
      ahorroFuel,
      ahorroMoney,
      naiveDist,
      comparison,
    };
  }

  get log() {
    return [...this._log];
  }
}
