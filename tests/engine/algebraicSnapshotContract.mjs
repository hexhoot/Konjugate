/* Copyright © 2026 Zenin Easa Panthakkalakath */

// Contract for algebraic (setsValue) states read by other nodes:
//   - a bidirectional edge that reads an algebraic state conserves exactly: both ends read the same
//     value (a source s and a tank y joined by a flow of r = y/2 keep s + y = 12)
//   - the recorded algebraic value matches the states recorded with it (r = y/2 at every sample)
//   - a time-only algebraic state (a = 10 t, like a data replay) gives every reader, its own node
//     included, the value at the start of each step, so a' = a integrates to the left Riemann sum
//   - an algebraic state whose initial value contradicts its expression (r = 5 where y/2 = 1) is
//     set from its expression before the first step: it is recorded as 1 at t = 0, and the flow
//     still conserves from the first step on

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

const appearance = { type: 'primitive', shape: 'box', color: '#2f6970' };
const document = {
    format: 'konjugate', version: 1, metadata: { units: 'SI' },
    nodes: [
        { id: 1, name: 'Source', position: [0, 0, 0], appearance, sourceTerms: [], states: [{ id: 11, name: 's', symbol: 's', initialValue: 10, unit: '' }] },
        {
            id: 2, name: 'Tank', position: [3, 0, 0], appearance,
            states: [{ id: 21, name: 'y', symbol: 'y', initialValue: 2, unit: '' }, { id: 22, name: 'r', symbol: 'r', initialValue: 1, unit: '' }],
            sourceTerms: [{
                id: 23, state: 'r', expression: 'y/2', setsValue: true,
                expressionModel: { latex: '\\frac{y}{2}', output: { stateId: 22 }, mathJson: ['Divide', 'y', '2'], bindings: [{ kind: 'state', nodeId: 2, stateId: 21, symbol: 'y' }] }
            }]
        },
        {
            id: 3, name: 'Clock', position: [0, 3, 0], appearance,
            states: [{ id: 31, name: 'a', symbol: 'a', initialValue: 0, unit: '' }, { id: 32, name: 'Own integral', symbol: 'own', initialValue: 0, unit: '' }],
            sourceTerms: [
                {
                    id: 33, state: 'a', expression: '10 t', setsValue: true,
                    expressionModel: { latex: '10 t', output: { stateId: 31 }, mathJson: ['Multiply', '10', 't'], bindings: [{ kind: 'time', symbol: 't' }] }
                },
                {
                    id: 34, state: 'own', expression: 'a',
                    expressionModel: { latex: 'a', output: { stateId: 32 }, mathJson: 'a', bindings: [{ kind: 'state', nodeId: 3, stateId: 31, symbol: 'a' }] }
                }
            ]
        },
        { id: 4, name: 'Reader', position: [3, 3, 0], appearance, sourceTerms: [], states: [{ id: 41, name: 'Integral', symbol: 'integral', initialValue: 0, unit: '' }] }
    ],
    edges: [
        {
            id: 5, name: 'Flow', source: { nodeId: 1, stateId: 11 }, target: { nodeId: 2, stateId: 21 }, directionality: 'bidirectional', equation: 'targetR', parameters: [],
            equationModel: { latex: '\\mathrm{targetR}', output: { role: 'target', stateId: 21 }, mathJson: 'targetR', bindings: [{ kind: 'state', role: 'target', nodeId: 2, stateId: 22, symbol: 'targetR' }] }
        },
        {
            id: 6, name: 'Read the clock', source: { nodeId: 3, stateId: 31 }, target: { nodeId: 4, stateId: 41 }, directionality: 'directed', equation: 'sourceA', parameters: [],
            equationModel: { latex: '\\mathrm{sourceA}', output: { role: 'target', stateId: 41 }, mathJson: 'sourceA', bindings: [{ kind: 'state', role: 'source', nodeId: 3, stateId: 31, symbol: 'sourceA' }] }
        }
    ]
};

const executable = process.argv[2];
if (!executable) throw new Error('Pass the konjugateEngine executable path.');
const directory = await mkdtemp(join(tmpdir(), 'konjugateAlgebraicSnapshot-'));
// Runs `model` for 3 s in steps of 1 s and returns its samples.
async function run(model, name) {
    const inputPath = join(directory, `${name}.kjt`);
    const reportPath = join(directory, `${name}.report`);
    const outputPath = join(directory, `${name}.kjr`);
    const configurationPath = join(directory, `${name}.json`);
    await writeFile(inputPath, await encodeProjectFile(JSON.stringify(model)));
    await writeFile(configurationPath, JSON.stringify({ name, targetTime: 3, globalTimeStep: 1, outputInterval: 1 }));
    assert.equal(await execute(executable, ['validate', inputPath, '--report', reportPath]), 0);
    const report = decodeValidationReport(await readFile(reportPath));
    assert.equal(report.valid, true, JSON.stringify(report.issues));
    assert.equal(await execute(executable, ['run', inputPath, '--configuration', configurationPath, '--output', outputPath]), 0);
    return decodeResultFile(await readFile(outputPath)).samples;
}

try {
    const inputPath = join(directory, 'model.kjt');
    const reportPath = join(directory, 'model.report');
    const outputPath = join(directory, 'model.kjr');
    const configurationPath = join(directory, 'run.json');
    await writeFile(inputPath, await encodeProjectFile(JSON.stringify(document)));
    await writeFile(configurationPath, JSON.stringify({ name: 'contract', targetTime: 3, globalTimeStep: 1, outputInterval: 1 }));
    assert.equal(await execute(executable, ['validate', inputPath, '--report', reportPath]), 0);
    const report = decodeValidationReport(await readFile(reportPath));
    assert.equal(report.valid, true, JSON.stringify(report.issues));
    assert.equal(await execute(executable, ['run', inputPath, '--configuration', configurationPath, '--output', outputPath]), 0);
    const { samples } = decodeResultFile(await readFile(outputPath));
    const value = (sample, stateId) => sample.states.find((state) => state.stateId === stateId).value;
    assert.equal(samples.length, 4);

    for (const sample of samples) {
        const [s, y, r] = [value(sample, 11), value(sample, 21), value(sample, 22)];
        assert.ok(Math.abs(s + y - 12) < 1e-12, `The flow must conserve s + y = 12 (t=${sample.time}: s=${s}, y=${y}).`);
        assert.ok(Math.abs(r - y / 2) < 1e-12, `The recorded r must match the recorded y (t=${sample.time}: y=${y}, r=${r}).`);
        assert.ok(Math.abs(value(sample, 31) - 10 * sample.time) < 1e-12, `a = 10 t must match its sample time (t=${sample.time}).`);
    }
    // y grows by r = y/2 each 1 s step: 2, 3, 4.5, 6.75.
    assert.deepEqual(samples.map((sample) => value(sample, 21)), [2, 3, 4.5, 6.75]);
    // Left Riemann sum of 10 t over 0, 1, 2: 0, 0, 10, 30 -- for the other node and the owner alike.
    assert.deepEqual(samples.map((sample) => value(sample, 41)), [0, 0, 10, 30], 'Another node must read a at the start of each step.');
    assert.deepEqual(samples.map((sample) => value(sample, 32)), [0, 0, 10, 30], 'The owning node must read a at the same instant as other nodes.');

    // The tank's r starts at 5, contradicting r = y/2 = 1: it is settled before the first step.
    const contradicting = structuredClone(document);
    contradicting.nodes[1].states[1].initialValue = 5;
    const settled = await run(contradicting, 'contradicting');
    assert.equal(value(settled[0], 22), 1, 'An algebraic state must be set from its expression before the first step.');
    for (const sample of settled) {
        assert.ok(Math.abs(value(sample, 11) + value(sample, 21) - 12) < 1e-12, `The flow must conserve from the first step on (t=${sample.time}).`);
    }

    console.log('✓ algebraic snapshot contract: a bidirectional edge reading an algebraic state conserves, recorded values match their states, every reader sees the same value, and a contradicting initial value is settled before the first step.');
} finally {
    await rm(directory, { recursive: true, force: true });
}
