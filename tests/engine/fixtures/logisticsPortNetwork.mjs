/* Copyright © 2026 Zenin Easa Panthakkalakath */

// A small port -> warehouse -> demand-zone network, built as the integration test point for
// piecewise (\begin{cases}) equations and as a first sketch of a logistics toolbox model.
//
//   Port --dispatch--> Warehouse A --deliver--> Zone 1 (priority), Zone 2
//        --dispatch--> Warehouse B --deliver--> Zone 3
//
// Units: TEU and days. Engine time is seconds, so every rate is divided by the shared
// secondsPerDay parameter (a literal 1/86400 would parse as an unsupported Rational).
// Equations have no time symbol, so the port and each zone carry an "elapsedDays" clock state (not "day": the LaTeX parser reads \\mathrm{day} as the unit d) for the
// time-based rules (the gate outage window and the demand step).
//
// Where cases are used:
//   - order-up-to policy: order only while the inventory position is below target
//   - gate outage: reduced capacity while outageStart <= day < outageEnd
//   - expediting: shorter lead time while on-hand stock is below a threshold
//   - priority allocation: Zone 2 is only served while Warehouse A is above its safety stock
//   - demand step: demand multiplied from stepDay onwards
//
// Lead times are Erlang-3: three in-transit stages per inbound lane, so every TEU in transit is
// a state and the network conserves TEU exactly.

import { reconcileEquationBindings, validateEquationLatex } from '../../../src/equationModel.mjs';

const secondsPerDay = 86400;

export const logisticsDefaults = {
    vesselArrivals: 100,        // TEU/day arriving at the port
    gateCapacity: 150,          // TEU/day the port gate can release
    outageCapacity: 150,        // TEU/day during the outage window (= gateCapacity: no outage)
    outageStart: 20,
    outageEnd: 50,
    stepDay: 20,
    stepMultiplier: 1,          // demand multiplier from stepDay (1: no step)
    days: 120
};

export function buildLogisticsPortNetwork(options = {}) {
    const settings = { ...logisticsDefaults, ...options };
    let nextId = 1;
    const id = () => nextId++;
    const sharedParameters = [];
    const shared = (name, symbol, value, unit) => {
        const parameter = { id: id(), name, symbol, value, unit, mode: 'constant' };
        sharedParameters.push(parameter);
        return parameter;
    };
    const linked = (sharedParameter, symbol = sharedParameter.symbol) => ({
        id: id(), name: sharedParameter.name, symbol, value: sharedParameter.value, unit: sharedParameter.unit,
        mode: 'constant', sharedParameterId: sharedParameter.id
    });
    const local = (name, symbol, value, unit) => ({ id: id(), name, symbol, value, unit, mode: 'constant' });

    const node = (name, type, position, color, states) => ({
        id: id(), name, type, position, sourceTerms: [],
        states: states.map(([symbol, stateName, initialValue, unit]) => ({ id: id(), name: stateName, symbol, initialValue, unit })),
        appearance: { type: 'primitive', shape: 'box', color }
    });
    const stateOf = (owner, symbol) => owner.states.find((state) => state.symbol === symbol);

    const sourceTerm = (owner, stateSymbol, latex, termParameters = []) => {
        const parameters = [...termParameters, linked(secondsPerDayParameter)];
        const bindings = [
            ...owner.states.map((state) => ({ kind: 'state', nodeId: owner.id, stateId: state.id, symbol: state.symbol })),
            ...parameters.map((parameter) => ({ kind: 'parameter', parameterId: parameter.id, symbol: parameter.symbol }))
        ];
        const validation = validateEquationLatex(latex, bindings);
        if (!validation.valid) throw new Error(`${owner.name} ${stateSymbol}: ${validation.errors.join(' ')}`);
        owner.sourceTerms.push({
            id: id(), state: stateSymbol, expression: latex, parameters,
            expressionModel: { latex, bindings, output: { stateId: stateOf(owner, stateSymbol).id }, mathJson: validation.mathJson }
        });
    };

    const edges = [];
    const edge = (name, source, target, outputSymbol, directionality, latex, edgeParameters, color) => {
        const parameters = [...edgeParameters, linked(secondsPerDayParameter)];
        const bindings = reconcileEquationBindings([], source, target, parameters);
        const validation = validateEquationLatex(latex, bindings);
        if (!validation.valid) throw new Error(`${name}: ${validation.errors.join(' ')}`);
        const output = stateOf(target, outputSymbol);
        edges.push({
            id: id(), name,
            source: { nodeId: source.id, stateId: directionality === 'bidirectional' ? null : null },
            target: { nodeId: target.id, stateId: output.id },
            directionality, equation: latex,
            equationModel: { latex, output: { role: 'target', stateId: output.id }, bindings, mathJson: validation.mathJson },
            parameters, appearance: { color, offset: 0 }
        });
        return edges.at(-1);
    };

    // ---- shared parameters -------------------------------------------------------------------
    const secondsPerDayParameter = shared('Seconds per day', 'secondsPerDay', secondsPerDay, 's/day');
    const vesselArrivals = shared('Vessel arrivals', 'vesselArrivals', settings.vesselArrivals, 'TEU/day');
    const gateCapacity = shared('Gate capacity', 'gateCapacity', settings.gateCapacity, 'TEU/day');
    const outageCapacity = shared('Gate capacity during outage', 'outageCapacity', settings.outageCapacity, 'TEU/day');
    const outageStart = shared('Outage start', 'outageStart', settings.outageStart, 'day');
    const outageEnd = shared('Outage end', 'outageEnd', settings.outageEnd, 'day');
    const yardDrainDays = shared('Yard drain time', 'yardDrainDays', 0.5, 'day');
    const coverDays = shared('Stock cover target', 'coverDays', 3, 'day');
    const adjustDays = shared('Inventory adjustment time', 'adjustDays', 4, 'day');
    const smoothingDays = shared('Demand smoothing time', 'smoothingDays', 5, 'day');
    const responseDays = shared('Order response time', 'responseDays', 0.5, 'day');
    const drawDownDays = shared('Stock draw-down time', 'drawDownDays', 1, 'day');
    const stepDay = shared('Demand step day', 'stepDay', settings.stepDay, 'day');
    const stepMultiplier = shared('Demand step multiplier', 'stepMultiplier', settings.stepMultiplier, '');

    // ---- nodes -------------------------------------------------------------------------------
    const port = node('Port', 'Port', [-8, 0, 0], '#2e7591', [
        ['yard', 'Yard stock', 300, 'TEU'],
        ['elapsedDays', 'Elapsed days', 0, 'day']
    ]);
    sourceTerm(port, 'elapsedDays', '\\frac{1}{\\mathrm{secondsPerDay}}');
    sourceTerm(port, 'yard', '\\frac{\\mathrm{vesselArrivals}}{\\mathrm{secondsPerDay}}', [linked(vesselArrivals)]);

    const warehouses = [
        { name: 'Warehouse A', position: [0, 3, 0], demand: 70, leadTime: 2, expeditedLeadTime: 1, expediteBelow: 80, gateShare: 0.7 },
        { name: 'Warehouse B', position: [0, -3, 0], demand: 30, leadTime: 3, expeditedLeadTime: 1.5, expediteBelow: 30, gateShare: 0.3 }
    ].map((spec) => {
        const lane = spec.demand * spec.leadTime / 3;
        const warehouse = node(spec.name, 'Warehouse', spec.position, '#c16f55', [
            ['onHand', 'On hand', spec.demand * 3, 'TEU'],
            ['lane1', 'In transit, stage 1', lane, 'TEU'],
            ['lane2', 'In transit, stage 2', lane, 'TEU'],
            ['lane3', 'In transit, stage 3', lane, 'TEU'],
            ['forecast', 'Demand forecast', spec.demand, 'TEU/day']
        ]);
        const prefix = spec.name.endsWith('A') ? 'a' : 'b';
        const leadTime = shared(`${spec.name} lead time`, `${prefix}LeadTime`, spec.leadTime, 'day');
        const expeditedLeadTime = shared(`${spec.name} expedited lead time`, `${prefix}ExpeditedLeadTime`, spec.expeditedLeadTime, 'day');
        const expediteBelow = shared(`${spec.name} expedite below`, `${prefix}ExpediteBelow`, spec.expediteBelow, 'TEU');
        const laneParameters = () => [linked(leadTime, 'leadTime'), linked(expeditedLeadTime, 'expeditedLeadTime'), linked(expediteBelow, 'expediteBelow')];
        const stageRate = '\\frac{3}{\\mathrm{secondsPerDay}} \\cdot \\begin{cases} \\frac{1}{\\mathrm{expeditedLeadTime}} & \\mathrm{onHand} < \\mathrm{expediteBelow} \\\\ \\frac{1}{\\mathrm{leadTime}} & \\text{otherwise} \\end{cases}';
        sourceTerm(warehouse, 'lane1', `-${stageRate} \\cdot \\mathrm{lane1}`, laneParameters());
        sourceTerm(warehouse, 'lane2', `${stageRate} \\cdot (\\mathrm{lane1} - \\mathrm{lane2})`, laneParameters());
        sourceTerm(warehouse, 'lane3', `${stageRate} \\cdot (\\mathrm{lane2} - \\mathrm{lane3})`, laneParameters());
        sourceTerm(warehouse, 'onHand', `${stageRate} \\cdot \\mathrm{lane3}`, laneParameters());
        sourceTerm(warehouse, 'forecast', '-\\frac{\\mathrm{forecast}}{\\mathrm{secondsPerDay} \\cdot \\mathrm{smoothingDays}}', [linked(smoothingDays)]);
        return { ...spec, node: warehouse, leadTime };
    });

    // ---- port -> warehouse dispatch ----------------------------------------------------------
    // Ordered quantity: order-up-to (forecast plus a correction towards forecast * (lead time +
    // cover)), only while the inventory position is below target. Released quantity: the order,
    // capped by this warehouse's share of the gate (reduced during the outage window) and by what
    // is in the yard.
    const position = '\\mathrm{targetOnHand} + \\mathrm{targetLane1} + \\mathrm{targetLane2} + \\mathrm{targetLane3}';
    const target = '\\mathrm{targetForecast} \\cdot (\\mathrm{leadTime} + \\mathrm{coverDays} + \\mathrm{adjustDays})';
    const order = `\\begin{cases} \\mathrm{targetForecast} + \\frac{\\mathrm{targetForecast} \\cdot (\\mathrm{leadTime} + \\mathrm{coverDays}) - (${position})}{\\mathrm{adjustDays}} & ${position} < ${target} \\\\ 0 & \\text{otherwise} \\end{cases}`;
    const gate = '\\mathrm{gateShare} \\cdot \\begin{cases} \\mathrm{outageCapacity} & \\mathrm{outageStart} \\le \\mathrm{sourceElapsedDays} < \\mathrm{outageEnd} \\\\ \\mathrm{gateCapacity} & \\text{otherwise} \\end{cases}';
    for (const warehouse of warehouses) {
        edge(`Dispatch to ${warehouse.name}`, port, warehouse.node, 'lane1', 'bidirectional',
            `\\frac{1}{\\mathrm{secondsPerDay}} \\cdot \\min(${order}, \\min(${gate}, \\frac{\\mathrm{gateShare} \\cdot \\mathrm{sourceYard}}{\\mathrm{yardDrainDays}}))`,
            [
                local('Gate share', 'gateShare', warehouse.gateShare, ''),
                linked(warehouse.leadTime, 'leadTime'), linked(coverDays), linked(adjustDays),
                linked(gateCapacity), linked(outageCapacity), linked(outageStart), linked(outageEnd), linked(yardDrainDays)
            ], '#d98b54');
    }

    // ---- demand zones ------------------------------------------------------------------------
    const [warehouseA, warehouseB] = warehouses;
    const zones = [
        { name: 'Zone 1', position: [8, 5, 0], demand: 30, warehouse: warehouseA, share: 0.5, priority: true },
        { name: 'Zone 2', position: [8, 1, 0], demand: 40, warehouse: warehouseA, share: 0.5, priority: false },
        { name: 'Zone 3', position: [8, -3, 0], demand: 30, warehouse: warehouseB, share: 1, priority: true }
    ];
    const safetyStock = shared('Warehouse A safety stock', 'safetyStock', 60, 'TEU');
    for (const spec of zones) {
        const zone = node(spec.name, 'Demand zone', spec.position, '#52727a', [
            ['backlog', 'Backlog', spec.demand * 0.5, 'TEU'],
            ['delivered', 'Delivered (cumulative)', 0, 'TEU'],
            ['ordered', 'Ordered (cumulative)', 0, 'TEU'],
            ['elapsedDays', 'Elapsed days', 0, 'day']
        ]);
        const baseDemand = shared(`${spec.name} demand`, `zone${spec.name.at(-1)}Demand`, spec.demand, 'TEU/day');
        const demandParameters = () => [linked(baseDemand, 'baseDemand'), linked(stepMultiplier), linked(stepDay)];
        const demand = (day) => `\\mathrm{baseDemand} \\cdot \\begin{cases} \\mathrm{stepMultiplier} & ${day} \\ge \\mathrm{stepDay} \\\\ 1 & \\text{otherwise} \\end{cases}`;
        sourceTerm(zone, 'elapsedDays', '\\frac{1}{\\mathrm{secondsPerDay}}');
        sourceTerm(zone, 'backlog', `\\frac{${demand('\\mathrm{elapsedDays}')}}{\\mathrm{secondsPerDay}}`, demandParameters());
        sourceTerm(zone, 'ordered', `\\frac{${demand('\\mathrm{elapsedDays}')}}{\\mathrm{secondsPerDay}}`, demandParameters());

        // Shipments leave the warehouse and arrive as deliveries (bidirectional), and the same
        // amount clears the zone's backlog (directed, negative). Zone 2 is cut off below safety stock.
        const ship = `\\frac{1}{\\mathrm{secondsPerDay}} \\cdot \\min(\\frac{\\mathrm{targetBacklog}}{\\mathrm{responseDays}}, \\frac{\\mathrm{share} \\cdot \\mathrm{sourceOnHand}}{\\mathrm{drawDownDays}})`;
        const shipment = spec.priority ? ship
            : `\\begin{cases} ${ship} & \\mathrm{sourceOnHand} > \\mathrm{safetyStock} \\\\ 0 & \\text{otherwise} \\end{cases}`;
        const shipParameters = () => [
            local('Allocation share', 'share', spec.share, ''), linked(responseDays), linked(drawDownDays),
            ...(spec.priority ? [] : [linked(safetyStock)])
        ];
        edge(`Deliver ${spec.warehouse.name.at(-1)} to ${spec.name}`, spec.warehouse.node, zone, 'delivered', 'bidirectional', shipment, shipParameters(), '#73b9c2');
        edge(`Clear ${spec.name} backlog`, spec.warehouse.node, zone, 'backlog', 'directed', `-${shipment.startsWith('\\begin') ? `(${shipment})` : shipment}`, shipParameters(), '#73b9c2');
        // What the zone orders feeds the warehouse's demand forecast (exponential smoothing).
        edge(`${spec.name} demand signal`, zone, spec.warehouse.node, 'forecast', 'directed',
            `\\frac{${demand('\\mathrm{sourceElapsedDays}')}}{\\mathrm{secondsPerDay} \\cdot \\mathrm{smoothingDays}}`, [...demandParameters(), linked(smoothingDays)], '#8aa0a8');
        spec.node = zone;
    }

    // Bidirectional edges take the same state on the source as its counterpart: yard for
    // dispatch, onHand for deliveries.
    for (const item of edges) {
        const source = [port, ...warehouses.map((w) => w.node), ...zones.map((z) => z.node)].find((candidate) => candidate.id === item.source.nodeId);
        item.source.stateId = item.directionality === 'bidirectional'
            ? stateOf(source, source === port ? 'yard' : 'onHand').id
            : (source.states.find((state) => state.symbol === 'elapsedDays') ?? source.states[0]).id;
    }

    const runConfigurationId = id();
    return {
        format: 'konjugate', version: 1, copyright: 'Copyright © 2026 Zenin Easa Panthakkalakath',
        metadata: { units: 'SI' },
        nodes: [port, ...warehouses.map((w) => w.node), ...zones.map((z) => z.node)],
        edges, sharedParameters,
        runConfigurations: [{ id: runConfigurationId, name: `${settings.days} days`, globalTimeStep: 0.05 * secondsPerDay, outputInterval: secondsPerDay }],
        activeRunConfigurationId: runConfigurationId
    };
}

// node tests/engine/fixtures/logisticsPortNetwork.mjs <path.kjt> [JSON options] -- writes the
// model as a project file that opens in Konjugate.
if (import.meta.url === `file://${process.argv[1]}`) {
    const [{ writeFile }, { encodeProjectFile }] = await Promise.all([import('node:fs/promises'), import('../../../src/projectFile.mjs')]);
    const [path, options] = process.argv.slice(2);
    if (!path) throw new Error('Pass the .kjt path to write.');
    await writeFile(path, await encodeProjectFile(JSON.stringify(buildLogisticsPortNetwork(options ? JSON.parse(options) : {}), null, 2)));
    console.log(`Wrote ${path}`);
}
