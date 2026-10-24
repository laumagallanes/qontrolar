/**
 * Referencias regulatorias (informativas). NO constituyen asesoramiento legal ni una
 * declaración de cumplimiento. Se mostraron sólo fuentes oficiales cuyo enlace y contenido
 * se verificaron en la fecha indicada. Ver docs/referencias-regulatorias.md.
 */
export const REGULATORY_VERIFIED_ON = '2026-10-24';

export const REGULATORY_SCOPE =
  'Alcance: normativa alimentaria nacional (CAA) y fuentes municipales de Rosario (Santa Fe). ' +
  'No cubre normativa de medicamentos, productos veterinarios ni otras jurisdicciones.';

export const REGULATORY_SOURCES = [
  {
    id: 'caa-indice',
    authority: 'ANMAT – Ministerio de Salud de la Nación',
    title: 'Código Alimentario Argentino (CAA) – índice oficial de capítulos',
    url: 'https://www.argentina.gob.ar/anmat/codigoalimentario',
    note: 'Texto vigente publicado por capítulo; cada PDF indica su fecha de actualización.',
  },
  {
    id: 'caa-cap-ii',
    authority: 'ANMAT – CAA',
    title: 'CAA Capítulo II – Condiciones generales de fábricas y comercios de alimentos (actualizado 04/2025)',
    url: 'https://www.argentina.gob.ar/sites/default/files/capitulo_ii_establecactualiz_2025-04.pdf',
    note: 'Texto oficial del Capítulo II. La página del CAA indica actualización 04/2025; revisar la fecha de cada capítulo y sus normas modificatorias.',
  },
  {
    id: 'caa-art18-resfc122025',
    authority: 'ANMAT – Boletín Oficial de la República Argentina',
    title: 'Resolución Conjunta 12/2025 – sustitución del artículo 18 del CAA',
    url: 'https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-12-2025-411079/texto',
    note: 'Art. 18, inc. 11: locales con equipos de frío, cuando sean necesarios, deben asegurar temperaturas adecuadas para conservar distintos alimentos. El artículo remite a normas especiales por grupo; no fija un único valor numérico universal.',
  },
  {
    id: 'caa-art18quater-resfc62021',
    authority: 'ANMAT – Boletín Oficial de la República Argentina',
    title: 'Resolución Conjunta 6/2021 – artículo 18 quater del CAA (cámaras frigoríficas)',
    url: 'https://www.argentina.gob.ar/normativa/nacional/norma-346510/texto',
    note: 'Aplica específicamente a cámaras frigoríficas y antecámaras. Incluye medición verificable por la autoridad, sensor en el punto más caliente, alarma accionable desde el interior para seguridad del personal, termómetros de máxima y mínima y plan de contingencia. No generalizar estos requisitos a toda heladera/exhibidora minorista.',
  },
  {
    id: 'caa-art18bis-res872008',
    authority: 'ANMAT – Boletín Oficial de la República Argentina',
    title: 'Resolución Conjunta 87/2008 y 340/2008 – artículo 18 bis del CAA (HACCP)',
    url: 'https://www.argentina.gob.ar/normativa/nacional/norma-140212/texto',
    note: 'Aplica a establecimientos elaboradores/industrializadores y/o fraccionadores que implementen HACCP dentro de su alcance. Establece conservar los registros por un período como mínimo igual a la vida útil del producto; no extrapolar a todo registro de temperatura minorista.',
  },
  {
    id: 'rosario-carnet',
    authority: 'Municipalidad de Rosario',
    title: 'Carnet de manipulación de alimentos',
    url: 'https://www.rosario.gob.ar/inicio/carnet-de-manipulacion-de-alimentos',
    note: 'Indica que el carnet es obligatorio, tiene vigencia de 3 años, validez nacional, lo emite ASSAL y se exige por el art. 21 del CAA.',
  },
  {
    id: 'rosario-ord-1732',
    authority: 'Municipalidad de Rosario',
    title: 'Ordenanza 1732/1964 – bares (texto actualizado)',
    url: 'https://www.rosario.gob.ar/mr/normativa/otras-normas/ordenanzas/ordenanza-1732-1964',
    note: 'El digesto municipal publica el texto y sus modificaciones; regula el rubro bares/habilitación. Confirmar vigencia y alcance aplicable al caso. No establece por sí sola un umbral universal de temperatura para todos los comercios.',
  },
  {
    id: 'rosario-manual',
    authority: 'Municipalidad de Rosario',
    title: 'Manual para manipuladores de alimentos (material de estudio oficial)',
    url: 'https://www.rosario.gob.ar/inicio/sites/default/files/2026-07/manual_para_manipuladores_de_alimentos_alumno_ops.pdf',
    note: 'Material de capacitación; útil como guía de buenas prácticas, no como fuente de umbrales por producto.',
  },
  {
    id: 'rosario-normativa',
    authority: 'Municipalidad de Rosario',
    title: 'Digesto / buscador de normativa municipal',
    url: 'https://www.rosario.gob.ar/normativa/visualExterna/normativas.jsp',
    note: 'Consultar aquí las ordenanzas y decretos municipales vigentes aplicables a cada rubro.',
  },
];

/** Afirmaciones que requieren confirmación profesional / de la autoridad competente. */
export const REGULATORY_TO_CONFIRM = [
  'Temperaturas específicas de alimentos: dependen del capítulo del CAA aplicable, del rótulo/instrucción del fabricante y de la autoridad. Medicamentos y productos veterinarios están fuera del alcance alimentario del CAA y requieren revisar su régimen específico. Qontrol.ar no precarga estos valores.',
  'Retención: el CAA art. 18 bis establece conservar registros HACCP al menos por la vida útil del producto dentro del alcance de ese sistema; no extrapolar ese plazo a todo registro de temperatura de todo comercio minorista. Confirmar obligaciones aplicables al establecimiento y producto.',
  'Si un registro electrónico como el de Qontrol.ar es aceptado por el inspector como evidencia en su comercio: depende de la autoridad de control.',
  'Requisitos propios de farmacias y veterinarias (ANMAT, SENASA, colegios profesionales, Ministerio de Salud provincial): fuera del alcance verificado.',
  'Normas municipales de Rosario, ASSAL y requisitos de farmacias/veterinarias: verificar la norma específica y su alcance según actividad, producto y establecimiento; el digest municipal mantiene textos actualizados y modificatorios.',
];

export const OPERATIONAL_DISCLAIMER =
  'Qontrol.ar es una herramienta de monitoreo preventivo y soporte de evidencia operativa. Los registros de temperatura que genera son ' +
  'registros operativos internos del comercio: no reemplazan actas, libros o registros oficiales de inspección, ni constituyen ' +
  'habilitación, certificación o garantía de cumplimiento normativo.';
