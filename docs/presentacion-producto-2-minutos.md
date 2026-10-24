# Qontrol.ar — Presentación de producto (2 minutos)

Guion para decir en voz alta. Sólo el texto en bloques de cita (`>`) se pronuncia; los títulos, tiempos y notas son guía para quien presenta.

## Guion

### Bloque 1 — El problema (0:00–0:30)

> Pensemos en una farmacia, una veterinaria, una carnicería o una cocina. Todas tienen una heladera o una cámara que no puede fallar. Casi siempre el control depende de alguien que mira el termómetro y lo anota en una planilla. El problema es lo que pasa entre una anotación y la siguiente: una puerta mal cerrada, un corte de luz, un equipo que se apaga. Cuando alguien se da cuenta, la mercadería ya se perdió.

### Bloque 2 — La propuesta (0:30–1:05)

> Qontrol.ar es un monitor de temperatura para comercios. Cada punto de frío tiene sus límites, mínimo y máximo, que define el comercio según su producto y su equipo. El sistema guarda cada lectura, arma el historial y permite exportarlo. Si la temperatura sale del rango durante un tiempo configurable, abre una alerta en el panel. Y si un sensor deja de reportar, lo marca como desconectado. Y tiene una API con autenticación por dispositivo, lista para conectar sensores ESP32.

### Bloque 3 — Demo visual (1:05–1:35)

> Lo que ven es una demo con datos simulados: cuatro comercios ficticios y ocho sensores, no lecturas reales. Acá, el estado de cada punto y el gráfico de las últimas veinticuatro horas. La alerta abierta en el tablero es por un sensor sin conexión. Y en alertas vemos una alerta del historial por temperatura fuera de rango.

### Bloque 4 — Modelo comercial y cierre (1:35–2:00)

> El modelo es simple: una instalación inicial y un abono mensual por el monitoreo. La integración con WhatsApp ya está desarrollada, pero la vamos a activar recién cuando validemos una versión segura del proveedor. Qontrol.ar no reemplaza los controles que ya hacen: suma registros ordenados y aviso temprano para prevenir pérdidas. Si les interesa, lo pensamos para su comercio.

## Guía de diapositivas

1. **El problema** (Bloque 1)
   Foto o ícono de heladera/cámara de frío con cuatro rubros: farmacia, veterinaria, carnicería, gastronomía. Frase única: "¿Qué pasa entre una anotación y la siguiente?".

2. **Qué hace Qontrol.ar** (Bloque 2)
   Logo de Qontrol.ar y cuatro íconos con texto corto: *Monitor de temperatura · Historial exportable · Alertas de rango y desconexión · API lista para ESP32*.

3. **Demo** (Bloque 3)
   Panel en vivo o captura de la organización demo, con el rótulo **DEMO** visible. Señalar en orden: estado de los puntos → gráfico de 24 h → alerta abierta en el tablero por **sensor sin conexión** → en /alertas, **alerta del historial por temperatura fuera de rango** (no presentarla como abierta: puede no estarlo al momento de mostrar). Leyenda en pantalla: "Datos simulados".

4. **Modelo y contacto** (Bloque 4)
   *Instalación + abono mensual* (sin cifras). Línea aparte: "WhatsApp: integración desarrollada, se activa al validar una versión segura". Datos de contacto.

### Notas para quien presenta

- No mencionar precios, ni alertas por WhatsApp funcionando hoy, ni equipos ya instalados en clientes.
- No hablar de cumplimiento normativo, habilitaciones ni inspecciones: Qontrol.ar es una herramienta de registro operativo y prevención.
- Si preguntan por energía, cámaras u otras alertas: son módulos a futuro, no funciones actuales.
