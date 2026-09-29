/* Copyright © 2026 Zenin Easa Panthakkalakath */

import assert from 'node:assert/strict';
import test from 'node:test';
import { latexForBinding, reconcileEquationBindings, validateEquationLatex } from '../src/equationModel.mjs';

const source = { id: 1, states: [{ id: 2, symbol: 'temperature' }] };
const target = { id: 3, states: [{ id: 4, symbol: 'temperature' }] };
const parameter = { id: 5, symbol: 'conductance' };

test('creates stable-ID-backed state and parameter bindings', () => {
    const bindings = reconcileEquationBindings([], source, target, [parameter]);
    assert.deepEqual(bindings.map(({ symbol, kind }) => ({ symbol, kind })), [
        { symbol: 'sourceTemperature', kind: 'state' },
        { symbol: 'targetTemperature', kind: 'state' },
        { symbol: 'conductance', kind: 'parameter' }
    ]);
});

test('preserves equation symbols when a state is renamed', () => {
    const bindings = reconcileEquationBindings([], source, target, [parameter]);
    const renamedSource = { ...source, states: [{ id: 2, symbol: 'thermalState' }] };
    const reconciled = reconcileEquationBindings(bindings, renamedSource, target, [parameter]);
    assert.equal(reconciled[0].symbol, 'sourceTemperature');
    assert.equal(reconciled[0].stateId, 2);
});

test('uses the current parameter symbol after a parameter is renamed', () => {
    const bindings = reconcileEquationBindings([], source, target, [{ id: 5, symbol: 'p1' }]);
    const reconciled = reconcileEquationBindings(bindings, source, target, [{ id: 5, symbol: 'x' }]);
    assert.equal(reconciled[2].symbol, 'x');
    assert.equal(validateEquationLatex('x+1', reconciled).valid, true);
});

test('parses bound LaTeX into MathJSON', () => {
    const bindings = reconcileEquationBindings([], source, target, [parameter]);
    const latex = `${latexForBinding(bindings[2])}\\cdot(${latexForBinding(bindings[0])}-${latexForBinding(bindings[1])})`;
    const result = validateEquationLatex(latex, bindings);
    assert.equal(result.valid, true);
    assert.deepEqual(result.mathJson, [
        'Multiply', 'conductance', ['Add', 'sourceTemperature', ['Negate', 'targetTemperature']]
    ]);
});

test('rejects unknown symbols and unsupported assignments', () => {
    const bindings = reconcileEquationBindings([], source, target, [parameter]);
    assert.match(validateEquationLatex('mystery+1', bindings).errors.join(' '), /Unknown/);
    assert.match(validateEquationLatex('x=2', bindings).errors.join(' '), /Unsupported/);
});

test('accepts a cases expression and rejects comparisons outside its conditions', () => {
    const bindings = [{ symbol: 'sourceStock' }, { symbol: 'rate' }];
    const valid = validateEquationLatex(String.raw`\begin{cases} \mathrm{rate} & \text{if } \mathrm{sourceStock} > 0 \land \mathrm{rate} \le 5 \\ 0 & \text{otherwise} \end{cases}`, bindings);
    assert.equal(valid.valid, true, valid.errors.join(' '));
    assert.equal(valid.mathJson[0], 'Which');
    assert.deepEqual(valid.mathJson.slice(2), ['rate', 'True', 0]);

    const noOtherwise = validateEquationLatex(String.raw`\begin{cases} \mathrm{rate} & \mathrm{sourceStock} > 0 \end{cases}`, bindings);
    assert.equal(noOtherwise.valid, false);
    assert.match(noOtherwise.errors.join(' '), /otherwise/);

    const bareComparison = validateEquationLatex(String.raw`\mathrm{sourceStock} > 0`, bindings);
    assert.equal(bareComparison.valid, false);
    assert.match(bareComparison.errors.join(' '), /condition of a cases expression/);
});
