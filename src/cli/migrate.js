import { bootstrap } from '../runtime.js';

const { db } = await bootstrap();
console.log('[db] migraciones al día');
await db.close();
