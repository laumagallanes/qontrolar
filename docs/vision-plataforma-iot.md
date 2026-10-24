# Qontrol.ar — Visión de plataforma IoT

Qontrol.ar se plantea como una plataforma IoT adaptable por comercio: un nodo ESP32 puede integrarse con distintos sensores para medir lo que cada negocio necesita. **Hoy sólo está implementado el módulo Qontrol Frío.** Este documento describe una dirección de producto, no funcionalidad desplegada.

## Hoy vs. futuro

| | Hoy (implementado) | Futuro (propuesta, no implementado) |
|---|---|---|
| Módulo | Qontrol Frío: puntos de frío (heladera, freezer, cámara, exhibidora) | Módulos separados por variable: energía, puerta, agua, gas, consumo |
| Métrica | Temperatura (°C) y humedad opcional | Una métrica por tipo de sensor, con su unidad |
| Reglas | Mínimo/máximo por punto, demora de alerta y umbral de desconexión | Reglas propias de cada módulo (rango, estado abierto/cerrado, acumulado, etc.) |
| Eventos | `temp_high`, `temp_low`, `device_offline` | Eventos específicos por módulo |
| Histórico | Lecturas por punto, gráfico de 24 h y CSV | Histórico por métrica |
| API | `POST /api/v1/readings` con token Bearer por dispositivo, esquema de temperatura | No hay API genérica de métricas: habría que diseñarla y desplegarla |

## Patrón extensible propuesto

Cada módulo nuevo debería definir, como mínimo:

1. **Tipo de métrica**: qué se mide (p. ej. puerta abierta/cerrada, consumo eléctrico).
2. **Unidad**: °C, kWh, L, booleano, etc., con validación de rango físico plausible.
3. **Umbral o regla**: configurable por punto y por comercio; sin valores normativos precargados, igual que en Qontrol Frío.
4. **Evento**: qué condición abre y cierra una alerta, con demora para evitar falsos positivos.
5. **Histórico**: almacenamiento, visualización y exportación de la serie.

Qontrol Frío es la referencia de este patrón, pero su modelo de datos y su API están específicamente pensados para temperatura. Generalizarlos requiere migraciones, cambios en la ingesta y en el panel, y pruebas propias.

## Dependencias reales

- **Hardware**: cada variable necesita un sensor adecuado (sensor magnético de puerta, pinza amperométrica, caudalímetro, detector de gas, etc.), su conexión al ESP32 y su firmware.
- **Instalación**: algunas mediciones (energía, gas, agua) pueden requerir instalación por personal habilitado y acceso a tableros o cañerías.
- **Calibración**: lecturas confiables requieren calibrar y validar cada sensor en condiciones reales.
- **Conectividad**: Wi-Fi estable en el punto de medición, manejo de cortes y reenvío de lecturas pendientes.
- **Seguridad**: token individual por dispositivo, rotación/revocación y revisión de cada nuevo endpoint antes de exponerlo.

## Aclaraciones

- Nada de lo descrito como "futuro" está implementado ni tiene fecha comprometida.
- Ningún módulo, actual o futuro, certifica instalaciones ni garantiza cumplimiento normativo. Ver [`referencias-regulatorias.md`](referencias-regulatorias.md).
- Las notificaciones por WhatsApp están desarrolladas pero desactivadas hasta validar una versión segura del proveedor. Ver [`evolution-whatsapp.md`](evolution-whatsapp.md).
