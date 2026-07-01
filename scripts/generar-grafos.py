#!/usr/bin/env python3
"""
Generador de grafos viarios para ISOTime — Motor Dijkstra local
================================================================
Descarga grafos OSM por ciudad con OSMnx y los serializa a binario CSR
para que el frontend los cargue en un Web Worker y calcule isocronas
con Dijkstra, sin depender de ninguna API de routing externa.

Uso:
  python3 scripts/generar-grafos.py                    # Todas las ciudades
  python3 scripts/generar-grafos.py --ciudad madrid     # Una ciudad
  python3 scripts/generar-grafos.py --listar            # Listar ciudades
"""

import argparse
import os
import sys
import struct
import numpy as np

# ─────────────────────────────────────────────────────────
# Catálogo de ciudades españolas
# ─────────────────────────────────────────────────────────
CIUDADES = [
    # (nombre, query OSM, lat, lng, radio_km)
    ("madrid",     "Madrid, Comunidad de Madrid, España",          40.4168,  -3.7038, 12),
    ("barcelona",  "Barcelona, Cataluña, España",                  41.3851,   2.1734, 15),
    ("valencia",   "Valencia, Comunidad Valenciana, España",       39.4699,  -0.3763, 15),
    ("sevilla",    "Sevilla, Andalucía, España",                   37.3891,  -5.9845, 15),
    ("zaragoza",   "Zaragoza, Aragón, España",                    41.6488,  -0.8891, 15),
    ("malaga",     "Málaga, Andalucía, España",                    36.7213,  -4.4214, 15),
    ("murcia",     "Murcia, Región de Murcia, España",             37.9922,  -1.1307, 15),
    ("palma",      "Palma, Islas Baleares, España",                39.5696,   2.6502, 12),
    ("bilbao",     "Bilbao, Bizkaia, País Vasco, España",          43.2630,  -2.9350, 12),
    ("alicante",   "Alicante, Comunidad Valenciana, España",       38.3452,  -0.4810, 12),
    ("cordoba",    "Córdoba, Andalucía, España",                   37.8882,  -4.7794, 12),
    ("valladolid", "Valladolid, Castilla y León, España",          41.6523,  -4.7245, 12),
    ("granada",    "Granada, Andalucía, España",                   37.1773,  -3.5986, 12),
    ("oviedo",     "Oviedo, Asturias, España",                     43.3623,  -5.8484, 12),
    ("pamplona",   "Pamplona, Comunidad Foral de Navarra, España", 42.8125,  -1.6458, 12),
    ("santander",  "Santander, Cantabria, España",                 43.4623,  -3.8090, 12),
    ("almeria",    "Almería, Andalucía, España",                   36.8381,  -2.4597, 12),
    ("sansebastian","San Sebastián, Gipuzkoa, País Vasco, España", 43.3183,  -1.9812, 12),
    ("burgos",     "Burgos, Castilla y León, España",              42.3439,  -3.6969, 12),
    ("logrono",    "Logroño, La Rioja, España",                    42.4627,  -2.4449, 12),
]

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "graphs")

# ─────────────────────────────────────────────────────────
# Formato binario CSR (Compressed Sparse Row)
# ─────────────────────────────────────────────────────────
# Header (32 bytes):
#   MAGIC: "ISOG" (4 bytes)
#   VERSION: u32
#   NUM_NODES: u32
#   NUM_EDGES: u32
#   CENTER_LAT: f32
#   CENTER_LNG: f32
#   RADIUS_KM: f32
#   RESERVED: u32
#
# City name (32 bytes, null-padded)
#
# Nodes (8 bytes/nodo):
#   node_lat: f32 × NUM_NODES
#   node_lng: f32 × NUM_NODES
#
# CSR (4 bytes/elemento):
#   node_offsets: u32 × (NUM_NODES + 1)
#   edge_targets: u32 × NUM_EDGES
#
# Edge data (4 bytes/elemento):
#   edge_lengths: f32 × NUM_EDGES  (metros)
#   edge_speeds:  f32 × NUM_EDGES  (km/h)

MAGIC = b"ISOG"
VERSION = 1


def generar_grafo(nombre, query, center_lat, center_lng, radius_km):
    """Descarga grafo OSM y lo serializa a binario CSR."""
    import osmnx as ox
    import networkx as nx

    print(f"  ↓ Descargando grafo OSM para {nombre} ({radius_km}km radio)...")

    # 1. Descargar grafo de calles
    dist = int(radius_km * 1000)
    G = ox.graph_from_point((center_lat, center_lng), dist=dist, network_type="drive")

    # 2. Añadir velocidades por tipo de vía
    G = ox.add_edge_speeds(G)
    G = ox.add_edge_travel_times(G)

    # 3. Convertir MultiDiGraph → DiGraph (fusionar aristas paralelas)
    G = nx.DiGraph(G)

    # 4. Relabel nodos a índices 0..N-1
    nodes = list(G.nodes())
    node_to_idx = {n: i for i, n in enumerate(nodes)}
    G = nx.relabel_nodes(G, node_to_idx)

    num_nodes = len(nodes)
    num_edges = G.number_of_edges()
    print(f"  ✓ {num_nodes} nodos, {num_edges} aristas")

    # 5. Extraer coordenadas de nodos
    node_lats = np.zeros(num_nodes, dtype=np.float32)
    node_lngs = np.zeros(num_nodes, dtype=np.float32)
    for i in range(num_nodes):
        node_data = G.nodes[i]
        node_lats[i] = node_data["y"]  # lat
        node_lngs[i] = node_data["x"]  # lng

    # 6. Construir CSR: offsets + targets + lengths + speeds
    node_offsets = np.zeros(num_nodes + 1, dtype=np.uint32)
    edge_targets = np.zeros(num_edges, dtype=np.uint32)
    edge_lengths = np.zeros(num_edges, dtype=np.float32)
    edge_speeds = np.zeros(num_edges, dtype=np.float32)

    edge_idx = 0
    for i in range(num_nodes):
        node_offsets[i] = edge_idx
        for _, target, data in G.out_edges(i, data=True):
            edge_targets[edge_idx] = target
            edge_lengths[edge_idx] = float(data.get("length", 0))
            edge_speeds[edge_idx] = float(data.get("speed_kph", 50))
            edge_idx += 1
    node_offsets[num_nodes] = edge_idx

    assert edge_idx == num_edges, f"CSR mismatch: {edge_idx} != {num_edges}"

    # 7. Escribir binario
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    filepath = os.path.join(OUTPUT_DIR, f"{nombre}.bin")

    with open(filepath, "wb") as f:
        # Header (32 bytes)
        f.write(MAGIC)
        f.write(struct.pack("<I", VERSION))
        f.write(struct.pack("<I", num_nodes))
        f.write(struct.pack("<I", num_edges))
        f.write(struct.pack("<f", center_lat))
        f.write(struct.pack("<f", center_lng))
        f.write(struct.pack("<f", radius_km))
        f.write(struct.pack("<I", 0))  # reserved

        # City name (32 bytes)
        name_bytes = nombre.encode("utf-8")[:32]
        f.write(name_bytes + b"\x00" * (32 - len(name_bytes)))

        # Nodes
        node_lats.tofile(f)
        node_lngs.tofile(f)

        # CSR
        node_offsets.tofile(f)
        edge_targets.tofile(f)

        # Edge data
        edge_lengths.tofile(f)
        edge_speeds.tofile(f)

    size_mb = os.path.getsize(filepath) / (1024 * 1024)
    print(f"  💾 {filepath} ({size_mb:.2f} MB)")
    return num_nodes, num_edges, size_mb


def listar_ciudades():
    """Lista las ciudades disponibles en data/graphs/."""
    if not os.path.isdir(OUTPUT_DIR):
        print("No hay grafos generados todavía.")
        return
    files = sorted(f for f in os.listdir(OUTPUT_DIR) if f.endswith(".bin"))
    if not files:
        print("No hay grafos generados todavía.")
        return
    print(f"{'Ciudad':<20} {'Nodos':>8} {'Aristas':>8} {'Tamaño':>10}")
    print("-" * 50)
    for fname in files:
        filepath = os.path.join(OUTPUT_DIR, fname)
        size_mb = os.path.getsize(filepath) / (1024 * 1024)
        with open(filepath, "rb") as f:
            f.read(4)  # magic
            f.read(4)  # version
            num_nodes = struct.unpack("<I", f.read(4))[0]
            num_edges = struct.unpack("<I", f.read(4))[0]
        nombre = fname.replace(".bin", "")
        print(f"{nombre:<20} {num_nodes:>8} {num_edges:>8} {size_mb:>8.2f} MB")


def main():
    parser = argparse.ArgumentParser(description="Generador de grafos viarios para ISOTime")
    parser.add_argument("--ciudad", "-c", help="Generar solo una ciudad")
    parser.add_argument("--listar", "-l", action="store_true", help="Listar ciudades generadas")
    args = parser.parse_args()

    if args.listar:
        listar_ciudades()
        return

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    ciudades = CIUDADES
    if args.ciudad:
        ciudades = [c for c in CIUDADES if c[0] == args.ciudad]
        if not ciudades:
            print(f"Ciudad no encontrada: {args.ciudad}")
            print(f"Disponibles: {', '.join(c[0] for c in CIUDADES)}")
            sys.exit(1)

    print(f"Generando {len(ciudades)} grafo(s)...\n")
    total_nodes = 0
    total_edges = 0
    total_size = 0

    for nombre, query, lat, lng, radius in ciudades:
        print(f"📍 {nombre}")
        try:
            n, e, s = generar_grafo(nombre, query, lat, lng, radius)
            total_nodes += n
            total_edges += e
            total_size += s
        except Exception as ex:
            print(f"  ✗ Error: {ex}")
        print()

    print(f"══════════════════════════════════════════")
    print(f"Total: {total_nodes:,} nodos, {total_edges:,} aristas, {total_size:.2f} MB")
    print(f"Output: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
