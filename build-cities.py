"""
Gera cities-data.js a partir do dump JSON da API SIDRA (IBGE).
Tabela 6579 · variável 9324 (População residente estimada) · ano mais recente.

Uso:
  curl -sS -o ibge-pop.json "https://apisidra.ibge.gov.br/values/t/6579/n6/all/v/9324/p/last"
  python build-cities.py
"""
import json
import re
import os

INPUT = "ibge-pop.json"
OUTPUT = "cities-data.js"

with open(INPUT, encoding="utf-8") as f:
    raw = json.load(f)

# Primeiro item é o cabeçalho — pular
rows = raw[1:]

cities = []
for r in rows:
    name_uf = r.get("D1N", "")
    pop_str = r.get("V", "0")
    m = re.match(r"^(.+?)\s*-\s*([A-Z]{2})$", name_uf)
    if not m:
        continue
    name = m.group(1).strip()
    uf = m.group(2)
    try:
        pop = int(pop_str)
    except (ValueError, TypeError):
        continue
    if pop <= 0:
        continue
    cities.append((name, uf, pop))

# Ordena por população decrescente — datalist mostra grandes primeiro
cities.sort(key=lambda c: -c[2])

print(f"Cidades válidas: {len(cities)}")
print(f"Top 3: {cities[:3]}")
print(f"Bottom 3: {cities[-3:]}")
print(f"Total habitantes: {sum(c[2] for c in cities):,}")


def js_str(s):
    """Escapa string para literal JS com aspas duplas."""
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


lines = [
    "/* AUTO-GERADO a partir da base IBGE (SIDRA tabela 6579, var 9324).",
    f"   {len(cities)} municípios brasileiros, ordenados por população decrescente.",
    "   Não editar manualmente — re-gere com build-cities.py. */",
    "window.MARKET_TERRITORY_CITIES = [",
]
for n, uf, p in cities:
    lines.append(f'[{js_str(n)},"{uf}",{p}],')
lines[-1] = lines[-1].rstrip(",")
lines.append("];")

with open(OUTPUT, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(lines) + "\n")

print(f"Arquivo: {OUTPUT} · {os.path.getsize(OUTPUT):,} bytes")
