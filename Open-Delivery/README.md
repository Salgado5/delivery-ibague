# RouteForge Ibagué — Logística inteligente (CVRP + carga 3D)

Optimizador de entregas para **Ibagué, Tolima**. Primero decide **cuántos paquetes caben** en cada
vehículo (peso + volumen + geometría 3D) y luego **optimiza la ruta** de entrega con esos paquetes.

## Cómo usar
1. Abre `frontend/index.html` en Chrome/Firefox/Edge (necesita internet para el mapa).
2. Panel **Paquetes**: pulsa **Demo Ibagué (120)** o **Importar CSV** (`datos/paquetes_ibague.csv`).
3. Panel **Flota**: camión, van y moto, cada uno con su espacio ancho × alto × profundidad y capacidad de peso.
4. Panel **Rutas**: elige algoritmo y vehículos → **Optimizar Rutas**.
5. En cada ruta: **Ver en mapa**, **Ver carga** (planta y perfil del vehículo) y el orden de entrega.

## Formato del CSV de paquetes
```
id,direccion,tipo,peso_kg,alto_cm,ancho_cm,profundidad_cm,lat,lon,prioridad
P001,"Centro, Ibagué",caja,12.5,40,50,60,4.4389,-75.2322,media
```
- `tipo`: `sobre` (plano, se acuesta) o `caja` (puede rotar en las 6 orientaciones).
- Peso en kg, medidas en cm (si el encabezado termina en `_m`, van en metros). Acepta `,` o `;`.
- `prioridad` opcional (`alta|media|baja`). Se validan filas y coordenadas dentro de Ibagué.

> Las coordenadas del demo son **aproximadas** por barrio (Centro, Cádiz, Jordán, Picaleña, etc.).
> Para datos reales, usa la geocodificación de direcciones o el clic en el mapa.

## Vehículos (valores de referencia, editables)
| Tipo | Espacio de carga (ancho×alto×prof.) | Volumen | Peso máx. |
|------|------|------|------|
| 🚚 Camión (furgón tipo NHR) | 2.1 × 2.1 × 4.5 m | 19.8 m³ | 3500 kg |
| 🚐 Van | 1.5 × 1.3 × 2.5 m | 4.9 m³ | 800 kg |
| 🏍️ Moto (baúl) | 0.4 × 0.4 × 0.45 m | 0.07 m³ | 25 kg |

## Pipeline y algoritmos
| Paso | Algoritmo | Técnica | Dónde |
|------|-----------|---------|-------|
| Ordenar paquetes por zona | Merge sort | Divide y vencerás | `mergeSort()` |
| Distancias | Haversine × 1.3 (tortuosidad urbana) | — | `buildDistMatrix()` |
| Análisis del grafo | Dijkstra, Kruskal (MST = cota inferior) | Voraz | `dijkstra()`, `kruskal()` |
| **Qué paquetes llevar** | **Knapsack 0/1 bidimensional (peso × volumen)** | **Prog. dinámica (tabulación)** + reconstrucción por backtracking | `knapsack2D()` |
| **¿Caben en el espacio?** | **Empaquetado 3D (guillotina, best-fit, rotaciones)** | Voraz | `empacar3D()` |
| Verificación | Si algo no cabe, se descarta el más grande y se repite | — | `seleccionarCarga()` |
| **Orden de entrega** | **Backtracking con poda** (exacto, ≤ 9 paradas) | Backtracking | `backtrackingCVRP()` |
| Más de 9 paradas | Vecino más cercano + **2-opt** | Voraz + mejora local | `greedyNearestNeighbor()`, `twoOpt()` |
| Flota | Camión → van → moto; si sobran paquetes, nueva ronda | Voraz | `solveCVRP()` |

Paquetes a la misma dirección se agrupan en **una sola parada**. Si un paquete no cabe en ningún
vehículo, se reporta como **no entregado**.

## Clases POO
- `Pedido`: código, dirección, lat/lng, peso, **alto, ancho, profundidad, tipo (sobre/caja)**, prioridad; getter `volumen`.
- `Vehiculo`: tipo, **ancho/alto/profundidad**, capPeso, consumo, velocidad; getter `capVolumen`.
- `Ruta`: vehículo, paquetes en orden de entrega, paradas, **posiciones 3D de la carga**, distancia, tiempo, combustible, % ocupación.
- `EmpresaLogistica`: coordina pedidos, flota y optimización (depósito por defecto en Ibagué).

## Estructura
```
Open-Delivery/
├── frontend/index.html, css/styles.css
├── algorithms.js   — motor (knapsack, 3D, BT, 2-opt, Dijkstra, Kruskal…)
├── models.js       — clases POO
├── csv.js          — lectura/validación del CSV
├── demo_ibague.js  — demo embebido (copia de datos/paquetes_ibague.csv)
├── app.js          — controlador UI + mapa (Leaflet/OSM, Nominatim)
└── datos/paquetes_ibague.csv
```

## Limitaciones conocidas
- Distancias = línea recta × 1.3, no calles reales (puedes activar OpenRouteService con `ORS_API_KEY` en `app.js`).
- El empaquetado 3D es heurístico: no garantiza el máximo posible, pero **siempre produce una carga válida** (sin solapes y apoyada).
- No considera el orden de descarga (LIFO), fragilidad ni ventanas horarias.
