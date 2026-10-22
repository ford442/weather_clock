/**
 * Refresh the satellite layer's offline TLE snapshot
 * (`src/sky/data/satellite-snapshot.json`) from Celestrak.
 *
 *   node scripts/update-satellite-snapshot.mjs
 *
 * Keeps every satellite that has a standard magnitude in `src/sky/satellites.js`
 * (so the committed set and the magnitude table stay in step), with the ISS
 * first. Celestrak asks clients not to poll; run this by hand, not in CI.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SNAPSHOT = resolve('src/sky/data/satellite-snapshot.json');
const SATELLITES_SOURCE = resolve('src/sky/satellites.js');
const CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php';
const ISS_ID = 25544;

/** NORAD ids listed in STANDARD_MAGNITUDES, read from the source so there is one list. */
async function trackedIds() {
    const source = await readFile(SATELLITES_SOURCE, 'utf8');
    const table = source.slice(
        source.indexOf('STANDARD_MAGNITUDES'),
        source.indexOf('});', source.indexOf('STANDARD_MAGNITUDES'))
    );
    return [...table.matchAll(/^\s*(\d{4,6}):/gm)].map((match) => Number(match[1]));
}

/** @param {number} id */
async function fetchTle(id) {
    const response = await fetch(`${CELESTRAK}?CATNR=${id}&FORMAT=tle`);
    if (!response.ok) throw new Error(`Celestrak ${id}: HTTP ${response.status}`);
    const [name, line1, line2] = (await response.text())
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim());
    if (!line1?.startsWith('1 ') || !line2?.startsWith('2 ')) throw new Error(`Celestrak ${id}: unexpected body`);
    return { id, name, line1, line2 };
}

const ids = await trackedIds();
const ordered = [ISS_ID, ...ids.filter((id) => id !== ISS_ID)];
const satellites = [];
for (const id of ordered) {
    try {
        satellites.push(await fetchTle(id));
    } catch (error) {
        console.warn(String(error));
    }
}
if (!satellites.some((entry) => entry.id === ISS_ID)) throw new Error('No ISS elements; snapshot left unchanged.');

const previous = JSON.parse(await readFile(SNAPSHOT, 'utf8'));
const snapshot = {
    source: 'Celestrak GP (CATNR queries)',
    retrieved: new Date().toISOString().slice(0, 10),
    note: previous.note,
    satellites
};
await writeFile(SNAPSHOT, `${JSON.stringify(snapshot, null, 4)}\n`);
console.log(`Wrote ${satellites.length} element sets to ${SNAPSHOT}`);
