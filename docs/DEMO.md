# Guía de la demo (90 segundos)

Recorrido sin cortes, en `http://localhost:3000`.

| # | Paso | Pantalla | Seg |
|---|---|---|---|
| 1 | Panel del inspector: se ve la cadena completa, los aportes y los KPIs | `/` | 15 |
| 2 | **Las dos alertas** del lote fraudulento, con su tx onchain | `/` (arriba) | 20 |
| 3 | Abrir el lote #6: la cadena hoja→procesado→packs con firmas cruzadas, y la discrepancia del FET | `/lote/6` | 20 |
| 4 | Mostrar que un lote honesto (#3) cierra: FET completo y reparto 60/30/10 | `/lote/3` | 10 |
| 5 | Acción en vivo: productor registra un fardo nuevo y lo transfiere al acopio; la cadena crece en tiempo real | `/acciones` + `/` | 20 |
| 6 | Cierre: escanear el QR del pack físico abre exactamente la vista del punto 3 | pack impreso | 5 |

## Qué decir en cada momento

- **Punto 2:** "La cigarrera declaró 80.000 packs pero solo entraron 900 kg de tabaco — eso da para 45.000. El monitor lo detectó y el inspector lo elevó onchain con su firma. La inconsistencia queda atribuible, no invisible."
- **Punto 5:** "Cada tramo necesita la firma de quien entrega Y de quien recibe. Nadie escribe solo."
- **La frase honesta:** "No eliminamos la mentira en el origen — la hacemos visible y atribuible. Hoy la subfacturación no deja rastro; acá cada declaración queda firmada."

## Plan B

- Si el nodo local no anda: el video se puede grabar igual porque todo corre en
  una máquina — grabar la secuencia 1-4 que solo necesita lectura.
- QR físico: generar un QR apuntando a `http://<ip-local>:3000/lote/6` y
  pegarlo en un pack real. Cualquier generador de QR sirve.

## Checklist antes de grabar

- [ ] `npm run node` arriba
- [ ] `npm run seed` corrido (lotes #3 y #6 existen)
- [ ] `node monitor.js --once` corrió → alertas onchain
- [ ] `npm run dev` en app/ responde 200 en `/`, `/lote/6`, `/acciones`
