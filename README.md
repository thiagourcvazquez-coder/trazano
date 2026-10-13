# TRAZANO

Trazabilidad onchain de la cadena del tabaco salteño, con cálculo y reparto
automático del Fondo Especial del Tabaco (FET). Proyecto para Monad Metropolis,
Track 04 · Trust, Identity & AI Infrastructure.

## El problema

El FET se financia con un impuesto de ~7% sobre cada pack vendido, declarado por
las propias cigarreras. El sector denuncia ~40% de operaciones subfacturadas:
~US$700M/año que no llegan a productores, seguridad social ni a los 60
municipios de Salta. En septiembre 2026 los productores pidieron públicamente
QR de trazabilidad en los paquetes (El Tribuno, La Nación, 17–21 sep 2026).

## Qué hace

Cadena de custodia firmada por ambas partes en cada tramo
(productor → acopio → cigarrera → pack con QR), balance de masa entre tabaco
registrado y packs declarados, aporte al FET calculado por contrato, reparto
automático 60/30/10, y un monitor que eleva las inconsistencias onchain con la
identidad del inspector.

## Estructura

| Carpeta | Contenido |
|---|---|
| `contracts/` | `ActorRegistry`, `BatchRegistry`, `FETVault`, `AlertRegistry`, `MockUSD` (Hardhat, Solidity 0.8.24) |
| `worker/` | Monitor de anomalías: detecta y eleva alertas onchain firmadas por el inspector |
| `app/` | Next.js: panel del inspector, vista pública del pack (QR), acciones por rol |
| `evaluation/` | Metodología y sets sintéticos para validar el monitor |
| `docs/` | Guía de demo y decisiones |

## Correr la demo local

```bash
cd contracts && npm install        # una vez
npm run node                       # terminal 1: nodo local

npm run seed                       # terminal 2: deploy + escenario demo

cd ../worker && npm install        # una vez
node monitor.js                    # terminal 3: monitor (o --once / --dry)

cd ../app && npm install           # una vez
npm run dev                        # terminal 4: http://localhost:3000
```

Tests: `cd contracts && npm test` (9 tests).

## El escenario

- **Lote #3 (honesto):** 2.000 kg hoja → 1.800 kg procesado → 50.000 packs,
  FET completo, reparto ejecutado.
- **Lote #6 (fraudulento):** 900 kg procesados → declara 80.000 packs (los
  insumos soportan ~45.000 → `BALANCE_DE_MASA`) y aporta la mitad del FET
  esperado → `FET_INCOMPLETO`. Ambas alertas quedan onchain.

## Límites honestos

El registro no impide mentir sobre los kg entregados: hace la inconsistencia
**visible y atribuible**. Despliegue real requiere al regulador y/o la Cámara
del Tabaco. Conversión kg→packs paramétrica (0,02 kg/pack, supuesto declarado).
