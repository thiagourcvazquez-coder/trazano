# TRAZANO — Documento para el equipo

> Trabajo en progreso — revisar antes de subir al repo oficial.

## 1. Qué es (la explicación corta)

TRAZANO es un sistema de **trazabilidad onchain de la cadena del tabaco salteño**, con cálculo y reparto automático del Fondo Especial del Tabaco (FET).

Cada entrega de tabaco (productor → acopio → cigarrera → packs) queda registrada en la blockchain de Monad, firmada por las dos partes involucradas. Sobre ese registro, un contrato calcula cuánto debería haber aportado cada cigarrera al FET, y un agente monitorea la cadena detectando inconsistencias que quedan elevadas onchain con firma del inspector.

El pack final lleva un QR: cualquiera lo escanea y ve la cadena completa de ese lote en el explorador.

## 2. El problema que resuelve

El FET se financia con un impuesto de ~7% sobre cada pack vendido que **declaran las propias cigarreras**. Hoy no hay forma de verificar que lo declarado sea real:

- El sector denuncia ~40% de operaciones subfacturadas → ~US$700M/año que no llegan a productores, seguridad social ni a los 60 municipios de Salta
- Los productores salteños están reclamando pagos atrasados del FET justo ahora
- En septiembre 2026 los propios productores pidieron públicamente QR de trazabilidad en los paquetes

Nosotros no inventamos la demanda: la industria ya la pidió.

## 3. El proceso (paso a paso)

```
1. PRODUCTOR registra la entrega de fardos
   → crea un "lote de hoja" onchain (kg, finca, hash de documentación)

2. PRODUCTOR propone transferencia → ACOPIO acepta
   → firma cruzada: ninguna de las dos partes puede mover el lote sola
   → el contrato fuerza la topología: la hoja SOLO puede ir a un acopio

3. ACOPIO procesa: consume lotes de hoja, emite lote "procesado"
   → el contrato marca los insumos como consumidos (habilita balance de masa)
   → transfiere a la cigarrera (misma firma cruzada)

4. CIGARRERA declara packs: consume procesado, emite lote "packs"
   → registra cantidad de packs y precio declarado por pack

5. CIGARRERA deposita el aporte FET
   → el contrato calcula lo esperado (packs × precio × 7%) y compara
   → si depositó de menos, la discrepancia queda pública onchain
   → reparte automático 60% productores / 30% municipios / 10% social

6. MONITOR (agente) lee los eventos y verifica dos invariantes:
   → BALANCE_DE_MASA: ¿los packs declarados cierran con los kg registrados?
   → FET_INCOMPLETO: ¿el depósito cubre el aporte calculado?
   → cada anomalía se eleva onchain firmada por el inspector

7. CONSUMIDOR escanea el QR del pack
   → ve toda la cadena, quién firmó cada tramo, y el estado del FET
```

## 4. La presentación (cómo se muestra)

Tres vistas:

| Vista | Quién | Qué ve |
|---|---|---|
| `/` — Panel del inspector | auditor / jurado | KPIs, alertas onchain con link al explorador, comparativa "declarado vs. soportado" por lote, estado del FET |
| `/lote/N` — Pack público | consumidor con el celu | QR real, timeline de la cadena, FET por pack, link al explorador de Monad |
| `/acciones` — Operación por rol | demo en vivo | ejecutar cada paso de la cadena como cada actor |

La demo cuenta una historia: **hay dos lotes, uno honesto y uno que no cierra**. El sistema solo muestra la inconsistencia — no acusa a nadie. El lote #6 declaró 80.000 packs sobre 900 kg de insumos (soportan ~45.000) y aportó la mitad del FET esperado. Ambas alertas quedaron elevadas onchain por el inspector.

## 5. Lo que falta / qué se modificaría para producción

Honesto — esto es un prototipo de hackathon:

| En la demo | En producción real |
|---|---|
| Los actores son wallets que genera el script | Cada empresa tendría su wallet real (Privy/passkey — el productor no guarda seed phrases) |
| El registro de actores lo hace el deployer | Lo operaría la Cámara del Tabaco o un regulador — es quien valida que "Finca El Cardón" es una empresa real |
| Declaración de kg en origen = palabra del productor | Punto débil irreductible (oracle problem): se mitiga con controles físicos, sellos en fardos, y el hecho de que la mentira queda *atribuible* — no se elimina, se hace visible |
| Conversión 0,02 kg/pack es un supuesto fijo | Parámetro configurable por producto/formato, eventualmente oráculo de normas industriales |
| El monitor corre en una PC | Servicio permanente del organismo fiscalizador |
| mUSD (token de prueba) | Stablecoin real o integración bancaria |
| Una sola cadena productor→acopio→cigarrera | Múltiples cadenas, múltiples provincias, múltiples productos (soja, vino, litio: mismo patrón) |

## 6. Qué demuestra

- **Las transferencias necesitan firma cruzada** — nadie mueve un lote solo
- **La topología está forzada por contrato** — la hoja no puede saltearse el acopio
- **El balance de masa expone la subdeclaración** — los números tienen que cerrar
- **La discrepancia del FET es pública y atribuible** — no es "el sistema está roto", es "esta declaración de esta empresa no cierra"
- **Todo es verificable en el explorador** — no es una maqueta, corre en Monad testnet

## 7. Estado actual

- ✅ 5 contratos deployed en Monad testnet, 9 tests verdes
- ✅ Escenario completo onchain (lote honesto + lote con discrepancia)
- ✅ 2 alertas elevadas onchain por el inspector
- ✅ App con 3 vistas, QR real
- ✅ Repo: github.com/thiagourcvazquez-coder/trazano
- ⏳ Video demo (falta grabar)
- ⏳ Carga en la plataforma del hackathon
