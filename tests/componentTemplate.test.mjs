/* Copyright © 2026 Zenin Easa Panthakkalakath */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { validateComponentTemplate } from '../src/componentTemplate.mjs';

const bundle = () => ({
    id: 'loadedMotor', kind: 'bundle', name: 'Loaded motor', domains: ['electrical'],
    endpoints: [{ id: 'supply', label: 'Supply' }, { id: 'motor', label: 'Motor' }],
    sharedParameters: [{ key: 'resistance', name: 'Winding resistance', symbol: 'resistance', value: 2, unit: 'Ω' }],
    edges: [{
        name: 'Drive', from: 'supply', to: 'motor', ports: { source: 'voltage', target: ['current', 'speed'] },
        output: { role: 'target', state: 'current' }, latex: '\\mathrm{sourceVoltage} / \\mathrm{resistance}',
        parameters: [{ name: 'Winding resistance', symbol: 'resistance', shared: 'resistance' }]
    }]
});

test('every bundled component template validates, bundles included', async () => {
    const directory = new URL('../assets/componentLibrary/', import.meta.url).pathname;
    const names = (await readdir(directory)).filter((name) => name.endsWith('.json') && name !== 'webManifest.json');
    const kinds = new Set();
    for (const name of names) kinds.add(validateComponentTemplate(JSON.parse(await readFile(join(directory, name), 'utf8'))).kind);
    assert.deepEqual([...kinds].sort(), ['bundle', 'edge', 'node']);
});

test('a well-formed bundle validates and is cloned', () => {
    const template = bundle();
    const validated = validateComponentTemplate(template);
    assert.deepEqual(validated, template);
    assert.notEqual(validated, template);
});

test('a bundle rejects malformed endpoints, edges and shared parameters', () => {
    const rejects = (mutate, pattern) => {
        const template = bundle();
        mutate(template);
        assert.throws(() => validateComponentTemplate(template), pattern);
    };
    rejects((t) => { t.endpoints = [t.endpoints[0]]; }, /at least two endpoints/);
    rejects((t) => { t.endpoints[1].id = 'supply'; }, /duplicated/);
    rejects((t) => { t.edges = []; }, /at least one edge/);
    rejects((t) => { t.edges[0].to = 'nowhere'; }, /between two different declared endpoints/);
    rejects((t) => { t.edges[0].to = 'supply'; }, /between two different declared endpoints/);
    rejects((t) => { delete t.edges[0].latex; }, /needs a latex/);
    rejects((t) => { t.edges[0].output.role = 'middle'; }, /needs an output/);
    rejects((t) => { t.edges[0].parameters[0].shared = 'missing'; }, /undeclared shared parameter/);
    rejects((t) => { t.sharedParameters.push({ ...t.sharedParameters[0] }); }, /unique key/);
    rejects((t) => { t.sharedParameters[0].value = 'two'; }, /finite value/);
    rejects((t) => { t.sharedParameters[0].scope = 'galaxy'; }, /scope/);
    rejects((t) => { t.sharedParameters[0].mode = 'live'; }, /slider control/);
});

const nodeWithTerms = () => ({
    id: 'stockpile', kind: 'node', name: 'Stockpile', domains: ['logistics'],
    states: [{ symbol: 'stock', label: 'Stock', initialValue: 10 }, { symbol: 'orderRate', label: 'Order rate', initialValue: 0 }],
    sharedParameters: [
        { key: 'cover', name: 'Cover', symbol: 'coverDays', value: 3, scope: 'project' },
        { key: 'drain', name: 'Drain time', symbol: 'drainDays', value: 2 }
    ],
    sourceTerms: [
        { state: 'stock', expression: '-\\frac{\\mathrm{stock}}{\\mathrm{drainDays}}', parameters: [{ name: 'Drain time', symbol: 'drainDays', shared: 'drain' }] },
        {
            state: 'orderRate', setsValue: true, expression: '\\mathrm{gain} \\cdot (\\mathrm{coverDays} - \\mathrm{stock})',
            parameters: [{ name: 'Gain', symbol: 'gain', value: 0.5 }, { name: 'Cover', symbol: 'coverDays', shared: 'cover' }]
        }
    ]
});

test('a node template can give its source terms parameters, shared parameters and algebraic outputs', () => {
    const template = nodeWithTerms();
    assert.deepEqual(validateComponentTemplate(template), template);
});

test('a node template rejects malformed source-term parameters and shared parameters', () => {
    const rejects = (mutate, pattern) => {
        const template = nodeWithTerms();
        mutate(template);
        assert.throws(() => validateComponentTemplate(template), pattern);
    };
    rejects((t) => { t.sourceTerms[0].parameters[0].shared = 'missing'; }, /undeclared shared parameter/);
    rejects((t) => { t.sourceTerms[1].parameters[0].value = 'half'; }, /finite value/);
    rejects((t) => { t.sourceTerms[1].parameters.push({ name: 'Gain again', symbol: 'gain', value: 1 }); }, /reuses the symbol "gain"/);
    rejects((t) => { t.sourceTerms[1].parameters[0].symbol = 'stock'; }, /reuses the symbol "stock"/);
    rejects((t) => { delete t.sourceTerms[1].parameters[0].name; }, /without a name and symbol/);
    rejects((t) => { t.sourceTerms[1].setsValue = 'yes'; }, /not a boolean/);
    rejects((t) => { t.sharedParameters[1].key = 'cover'; }, /node template shared parameter needs a unique key/);
    rejects((t) => { t.sharedParameters[0].scope = 'galaxy'; }, /node template shared parameter scope/);
});
