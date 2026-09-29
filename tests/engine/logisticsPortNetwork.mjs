/* Copyright © 2026 Zenin Easa Panthakkalakath */

// Integration test for piecewise (\begin{cases}) equations, on the port -> warehouse -> zone
// network in fixtures/logisticsPortNetwork.mjs. Runs three scenarios through the real engine CLI:
//   - baseline: a balanced network must stay exactly at its steady state
//   - gate outage: the outage window (a chained-comparison condition) must throttle the gate,
//     expediting must shorten Warehouse A's pipeline, and the priority rule must protect Zone 1
//     at Zone 2's expense
//   - demand step: order-up-to replenishment must over-order (bullwhip) after the step
// Every scenario must conserve TEU exactly and keep the backlog identity.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { encodeProjectFile } from '../../src/projectFile.mjs';
import { decodeResultFile } from '../../src/engineProtocol.mjs';
import { decodeValidationReport } from '../../src/reportProtocol.mjs';
import { buildLogisticsPortNetwork } from './fixtures/logisticsPortNetwork.mjs';

function execute(executable, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'inherit'] });
        child.once('error', reject);
        child.once('exit', resolve);
    });
}

const executable = process.argv[2];
if (!executable) throw new Error('Pass the konjugateEngine executable path.');
const directory = await mkdtemp(join(tmpdir(), 'konjugateLogistics-'));

async function run(name, options) {
    const document = buildLogisticsPortNetwork(options);
    const inputPath = join(directory, `${name}.kjt`);
    const reportPath = join(directory, `${name}.report`);
    const outputPath = join(directory, `${name}.kjr`);
    const configurationPath = join(directory, `${name}.json`);
    const { globalTimeStep, outputInterval } = document.runConfigurations[0];
    await writeFile(inputPath, await encodeProjectFile(JSON.stringify(document)));
    await writeFile(configurationPath, JSON.stringify({ name, targetTime: 120 * 86400, globalTimeStep, outputInterval }));

    assert.equal(await execute(executable, ['validate', inputPath, '--report', reportPath]), 0, `${name}: validation failed to run.`);
    const report = decodeValidationReport(await readFile(reportPath));
    assert.equal(report.valid, true, `${name}: ${JSON.stringify(report.issues ?? report)}`);
    assert.equal(await execute(executable, ['run', inputPath, '--configuration', configurationPath, '--output', outputPath]), 0, `${name}: run failed.`);
    const result = decodeResultFile(await readFile(outputPath));

    const stateIds = new Map(document.nodes.flatMap((node) => node.states.map((state) => [`${node.name}.${state.symbol}`, state.id])));
    const days = result.samples.map((sample) => sample.time / 86400);
    const series = (key) => {
        const stateId = stateIds.get(key);
        return result.samples.map((sample) => sample.states.find((state) => state.stateId === stateId).value);
    };
    return { document, days, series, arrivals: options.vesselArrivals ?? 100 };
}

function checkInvariants(name, { days, series, arrivals }) {
    const warehouses = ['Warehouse A', 'Warehouse B'];
    const zones = ['Zone 1', 'Zone 2', 'Zone 3'];
    const yard = series('Port.yard');
    const stocks = warehouses.flatMap((warehouse) => ['onHand', 'lane1', 'lane2', 'lane3'].map((symbol) => series(`${warehouse}.${symbol}`)));
    const delivered = zones.map((zone) => series(`${zone}.delivered`));
    const total = days.map((day, index) => yard[index] + stocks.reduce((sum, s) => sum + s[index], 0) + delivered.reduce((sum, s) => sum + s[index], 0) - arrivals * day);
    const drift = Math.max(...total.map((value) => Math.abs(value - total[0])));
    assert.ok(drift < 1e-5, `${name}: TEU must be conserved (drift ${drift}).`);
    for (const zone of zones) {
        const backlog = series(`${zone}.backlog`);
        const ordered = series(`${zone}.ordered`);
        const received = series(`${zone}.delivered`);
        const error = Math.max(...backlog.map((value, index) => Math.abs(value - backlog[0] - (ordered[index] - received[index]))));
        assert.ok(error < 1e-5, `${name}: ${zone} backlog must equal ordered minus delivered (error ${error}).`);
    }
    for (const s of [yard, ...stocks]) assert.ok(Math.min(...s) > -1e-9, `${name}: no stock may go negative.`);
}

const fill = (series, zone, from, to) => {
    const delivered = series(`${zone}.delivered`);
    const ordered = series(`${zone}.ordered`);
    return (delivered[to] - delivered[from]) / (ordered[to] - ordered[from]);
};

try {
    const baseline = await run('baseline', {});
    checkInvariants('baseline', baseline);
    for (const zone of ['Zone 1', 'Zone 2', 'Zone 3']) {
        assert.ok(Math.abs(fill(baseline.series, zone, 0, 120) - 1) < 1e-9, `baseline: ${zone} must be fully served.`);
    }
    assert.ok(Math.abs(baseline.series('Warehouse A.onHand').at(-1) - 210) < 1e-6, 'baseline: Warehouse A must stay at its steady state.');

    const outage = await run('outage', { outageCapacity: 30 });
    checkInvariants('outage', outage);
    const yard = outage.series('Port.yard');
    assert.ok(Math.abs(yard[20] - 300) < 1e-6, 'outage: nothing changes before the outage starts.');
    assert.ok(Math.abs(yard[50] - (300 + 70 * 30)) < 1, `outage: the yard must grow by arrivals minus the reduced gate (got ${yard[50]}).`);
    assert.ok(yard[80] < yard[50], 'outage: the yard must drain once the gate reopens.');
    const pipelineA = ['lane1', 'lane2', 'lane3'].reduce((sum, symbol) => sum + outage.series(`Warehouse A.${symbol}`)[40], 0);
    assert.ok(pipelineA < 25, `outage: expediting should cut Warehouse A's pipeline to ~21 TEU (1 day of 21 TEU/day), got ${pipelineA}.`);
    const zone1 = fill(outage.series, 'Zone 1', 20, 60);
    const zone2 = fill(outage.series, 'Zone 2', 20, 60);
    assert.ok(zone1 > zone2 + 0.3, `outage: the priority rule must protect Zone 1 (fill ${zone1}) over Zone 2 (fill ${zone2}).`);

    const step = await run('step', { stepMultiplier: 1.3, vesselArrivals: 150 });
    checkInvariants('step', step);
    const stepYard = step.series('Port.yard');
    const dispatched = stepYard.slice(1).map((value, index) => 150 - (value - stepYard[index]));
    const amplification = (Math.max(...dispatched) - 100) / (130 - 100);
    assert.ok(amplification > 1.2, `step: replenishment should amplify a 30 TEU/day demand step (amplification ${amplification}).`);

    console.log(`✓ logistics port network: cases conditions drive the outage, expediting, priority and demand step; TEU conserved; bullwhip ${amplification.toFixed(2)}x.`);
} finally {
    await rm(directory, { recursive: true, force: true });
}
