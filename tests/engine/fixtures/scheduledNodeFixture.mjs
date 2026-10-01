/* Copyright © 2026 Zenin Easa Panthakkalakath */

// A node whose parameters follow stored schedules (sharedParameters[].schedule), added to the code
// export and FMU fidelity documents so every export is checked against the engine on them:
//
//   inflow' = rate (rate held: 1 until t = 0.5, then 3, then -2 from t = 1.25, past which it is held)
//   level = 2 ramp + inflow (an algebraic state; ramp interpolated linearly from 0 at t = 0 to 4 at
//           t = 2, read at the instants the engine reads algebraic parameters)
//   drift' = 0.5 ramp (a second parameter linked to the same scheduled ramp, so one table serves both)

export const scheduledSharedParameterIds = { rate: 950, ramp: 951 };

export function addScheduledNode(document, { nodeId, stateIds, termIds, parameterIds }) {
    document.sharedParameters = [
        ...(document.sharedParameters ?? []),
        { id: scheduledSharedParameterIds.rate, name: 'Scheduled rate', symbol: 'scheduledRate', value: 7, unit: '', mode: 'constant',
            schedule: { interpolation: 'hold', samples: [[0, 1], [0.5, 3], [1.25, -2]] } },
        { id: scheduledSharedParameterIds.ramp, name: 'Scheduled ramp', symbol: 'scheduledRamp', value: 7, unit: '', mode: 'live',
            schedule: { interpolation: 'linear', samples: [[0, 0], [2, 4]] } }
    ];
    const linked = (id, shared, symbol) => ({ id, name: symbol, symbol, value: 0, mode: 'constant', sharedParameterId: shared });
    document.nodes.push({
        id: nodeId, name: 'Scheduled',
        states: [
            { id: stateIds.inflow, name: 'Inflow', symbol: 'inflow', initialValue: 0, unit: '' },
            { id: stateIds.level, name: 'Level', symbol: 'level', initialValue: 0, unit: '' },
            { id: stateIds.drift, name: 'Drift', symbol: 'drift', initialValue: 0, unit: '' }
        ],
        numerics: { substepsPerGlobalStep: 2 },
        sourceTerms: [
            {
                id: termIds.inflow, state: 'inflow', expression: 'rate',
                parameters: [linked(parameterIds.rate, scheduledSharedParameterIds.rate, 'rate')],
                expressionModel: {
                    latex: '', bindings: [{ kind: 'parameter', parameterId: parameterIds.rate, symbol: 'rate' }],
                    output: { stateId: stateIds.inflow }, mathJson: 'rate'
                }
            },
            {
                id: termIds.level, state: 'level', expression: '2 ramp + inflow', setsValue: true,
                parameters: [linked(parameterIds.ramp, scheduledSharedParameterIds.ramp, 'ramp')],
                expressionModel: {
                    latex: '', bindings: [
                        { kind: 'parameter', parameterId: parameterIds.ramp, symbol: 'ramp' },
                        { kind: 'state', nodeId, stateId: stateIds.inflow, symbol: 'x' }
                    ],
                    output: { stateId: stateIds.level }, mathJson: ['Add', ['Multiply', '2', 'ramp'], 'x']
                }
            },
            {
                id: termIds.drift, state: 'drift', expression: '0.5 ramp',
                parameters: [linked(parameterIds.rampAgain, scheduledSharedParameterIds.ramp, 'rampAgain')],
                expressionModel: {
                    latex: '', bindings: [{ kind: 'parameter', parameterId: parameterIds.rampAgain, symbol: 'rampAgain' }],
                    output: { stateId: stateIds.drift }, mathJson: ['Multiply', '0.5', 'rampAgain']
                }
            }
        ]
    });
    return document;
}
