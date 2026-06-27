import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { stocks } from './schema.js';
import { fetchAllStocks } from '../data/stocks_list.js';
const { Pool } = pg;
const pool = new Pool({
    host: process.env.PG_HOST || '/var/run/postgresql',
    port: Number(process.env.PG_PORT) || 5432,
    database: process.env.PG_DB || 'quant_ceo',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
});
const db = drizzle(pool);
async function main() {
    console.log('Fetching all A-share stocks...');
    const list = await fetchAllStocks();
    console.log(`Fetched ${list.length} stocks`);
    let inserted = 0;
    for (const s of list) {
        try {
            await db.insert(stocks).values(s).onConflictDoNothing();
            inserted++;
        }
        catch (e: any) {
            console.error(`Error inserting ${s.code} ${s.name}: ${e.message}`);
        }
    }
    console.log(`Inserted ${inserted} new stocks`);
    const count = await db.select().from(stocks);
    console.log(`Total stocks in DB: ${count.length}`);
    await pool.end();
}
main();
