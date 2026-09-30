/* Copyright © 2026 Zenin Easa Panthakkalakath */

// Contract for the time binding ({ kind: "time" }, t in equations):
//   - a differential term reads the substep's start time, so x' = t integrates to the left
//     Riemann sum exactly
//   - an algebraic (setsValue) term reads the instant of the states it is computed from, so the
//     recorded y = 10 t matches the sample time exactly
//   - a piecewise rate switches when t crosses its threshold, in edges as well as source terms
//   - restarting from a mid-run checkpoint reproduces the uninterrupted run, since t is absolute

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { encodeProjectFile } from '../../src/projectFile.mjs';
import { decodeResultFile } from '../../src/engineProtocol.mjs';
import { decodeValidationReport } from '../../src/reportProtocol.mjs';

function execute(executable, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'inherit'] });
        child.once('error', reject);
        child.once('exit', resolve);
    });
}

const time = { kind: 'time', symbol: 't' };
const local = (nodeId, stateId, symbol) => ({ kind: 'state', nodeId, stateId, symbol });
const term = (id, state, stateId, mathJson, bindings, setsValue = false) => ({
    id, state, expression: state, ...(setsValue ? { setsValue: true } : {}),
    expressionModel: { latex: state, bindings, output: { stateId }, mathJson }
});

const feedLatex = String.raw`\begin{cases} 2 & 0.95 \le t < 1.45 \\ 0 & \text{otherwise} \end{cases}`;

const document = {
    format: 'konjugate', version: 1, metadata: { units: 'SI' },
    nodes: [
        {
            id: 1, name: 'Clocked', position: [0, 0, 0], numerics: { substepsPerGlobalStep: 2 },
            states: [
                { id: 11, name: 'Integral of t', symbol: 'integral', initialValue: 0, unit: '' },
                { id: 12, name: 'Ten t', symbol: 'tenT', initialValue: 0, unit: '' },
                { id: 13, name: 'Switched', symbol: 'switched', initialValue: 0, unit: '' }
            ],
            sourceTerms: [
                term(101, 'integral', 11, 't', [time]),
                term(102, 'tenT', 12, ['Multiply', '10', 't'], [time], true),
                term(103, 'switched', 13, ['Which', ['Less', 't', '0.53'], '1', 'True', '3'], [time])
            ],
            appearance: { type: 'primitive', shape: 'box', color: '#2f6970' }
        },
        {
            id: 2, name: 'Receiver', position: [2, 0, 0],
            states: [{ id: 21, name: 'Received', symbol: 'received', initialValue: 0, unit: '' }],
            sourceTerms: [], appearance: { type: 'primitive', shape: 'box', color: '#2f6970' }
        }
    ],
    edges: [{
        id: 31, name: 'Timed feed', source: { nodeId: 1, stateId: 11 }, target: { nodeId: 2, stateId: 21 },
        directionality: 'directed', equation: feedLatex,
        equationModel: {
            latex: feedLatex, output: { role: 'target', stateId: 21 }, bindings: [time],
            mathJson: ['Which', ['And', ['LessEqual', '0.95', 't'], ['Less', 't', '1.45']], '2', 'True', '0']
        },
        parameters: []
    }]
};

const executable = process.argv[2];
if (!executable) throw new Error('Pass the konjugateEngine executable path.');
const directory = await mkdtemp(join(tmpdir(), 'konjugateTimeBinding-'));
const globalTimeStep = 0.1;
const substepTime = globalTimeStep / 2;

async function run(name, configuration) {
    const configurationPath = join(directory, `${name}.json`);
    const outputPath = join(directory, `${name}.kjr`);
    await writeFile(configurationPath, JSON.stringify({ name, globalTimeStep, outputInterval: 0.5, ...configuration }));
    assert.equal(await execute(executable, ['run', join(directory, 'model.kjt'), '--configuration', configurationPath, '--output', outputPath]), 0, `${name}: run failed.`);
    return decodeResultFile(await readFile(outputPath));
}
const valueOf = (sample, stateId) => sample.states.find((state) => state.stateId === stateId).value;

try {
    await writeFile(join(directory, 'model.kjt'), await encodeProjectFile(JSON.stringify(document)));
    const reportPath = join(directory, 'report.bin');
    assert.equal(await execute(executable, ['validate', join(directory, 'model.kjt'), '--report', reportPath]), 0);
    const report = decodeValidationReport(await readFile(reportPath));
    assert.equal(report.valid, true, JSON.stringify(report));

    const full = await run('full', { targetTime: 2 });
    for (const sample of full.samples) {
        if (sample.time === 0) continue;
        const substeps = Math.round(sample.time / substepTime);
        const leftSum = substepTime * substepTime * substeps * (substeps - 1) / 2;
        assert.ok(Math.abs(valueOf(sample, 11) - leftSum) < 1e-9, `A derivative must read the substep start time (t=${sample.time}).`);
        assert.ok(Math.abs(valueOf(sample, 12) - 10 * sample.time) < 1e-9, `A recorded algebraic value must match its sample time (t=${sample.time}).`);
    }
    const final = full.samples.at(-1);
    // switched: rate 1 for the 11 substeps starting before 0.53 s, then 3 for the remaining 29.
    assert.ok(Math.abs(valueOf(final, 13) - substepTime * (11 * 1 + 29 * 3)) < 1e-9, 'A piecewise source term must switch on t.');
    // received: rate 2 for the global steps starting at 1.0 .. 1.4 s, i.e. inside [0.95, 1.45) (edges read the global step start).
    assert.ok(Math.abs(valueOf(final, 21) - 2 * 5 * globalTimeStep) < 1e-9, 'A piecewise edge must switch on t.');

    const checkpoint = full.checkpoints.find((candidate) => Math.abs(candidate.time - 1) < 1e-9);
    assert.ok(checkpoint, 'The run must checkpoint at t=1.');
    const resumed = await run('resumed', { targetTime: 2, startCheckpoint: checkpoint });
    for (const stateId of [11, 12, 13, 21]) {
        assert.ok(Math.abs(valueOf(resumed.samples.at(-1), stateId) - valueOf(final, stateId)) < 1e-9,
            `Resuming from a checkpoint must reproduce the uninterrupted run (state ${stateId}).`);
    }
    console.log('✓ time binding contract: derivatives read the substep start, recorded algebraic values match their sample time, piecewise terms switch on t, and restarts match.');
} finally {
    await rm(directory, { recursive: true, force: true });
}
