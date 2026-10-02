/* Copyright © 2026 Zenin Easa Panthakkalakath */

// buildProvidersConfiguration() is what both startEngineRun and checkSubstepConvergenceWithEngine
// rely on to actually honor a configured Provider Toolchains interpreter/compiler path, instead of
// silently falling back to a bare "python3"/"cc" the OS resolves on its own -- on macOS, Apple's
// CommandLineTools stub python3 (no third-party packages installed, including Konjugate's own SDK);
// on Windows, the Microsoft Store App Execution Alias stub. checkSubstepConvergenceWithEngine used
// to build its own runConfiguration without ever calling this at all, which was the exact cause of
// a real "No module named konjugate" / "Python was not found" handshake failure reported on both
// platforms -- these tests are for the shared precedence logic itself, previously untested even in
// the startEngineRun path that happened to already be correct.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { buildProvidersConfiguration } from '../src/engineAdapter.mjs';

const options = { applicationPath: '/app', resourcesPath: '/resources', packaged: false };
const documentWithoutCppNode = { nodes: [{ id: 'n1', implementation: { kind: 'python' } }] };
const documentWithCppNode = { nodes: [{ id: 'n1', implementation: { kind: 'cpp' } }] };

test('defaults to sharedMemoryWorker, with no interpreter/compiler override, when nothing is configured', () => {
    const providers = buildProvidersConfiguration({}, options, documentWithoutCppNode);
    assert.equal(providers.executionMode, 'sharedMemoryWorker');
    assert.equal(providers.python.sdkPath, join('/app', 'engine', 'sdk', 'python'));
    assert.equal(providers.python.interpreter, undefined);
    assert.equal(providers.cpp.sdkPath, join('/app', 'engine'));
    assert.equal(providers.cpp.compiler, undefined);
});

test('a resolved document requiring an in-process cpp node provider defaults executionMode to inProcess', () => {
    const providers = buildProvidersConfiguration({}, options, documentWithCppNode);
    assert.equal(providers.executionMode, 'inProcess');
});

test('a configured Provider Toolchains interpreter/compiler path is actually used', () => {
    const toolchainOptions = { ...options, providerToolchains: { python: { interpreterPath: '/usr/local/bin/python3.12' }, cpp: { compilerPath: '/usr/bin/clang++' } } };
    const providers = buildProvidersConfiguration({}, toolchainOptions, documentWithoutCppNode);
    assert.equal(providers.python.interpreter, '/usr/local/bin/python3.12');
    assert.equal(providers.cpp.compiler, '/usr/bin/clang++');
});

test('executionMode precedence: explicit configuration.providers wins over the toolchain setting', () => {
    const toolchainOptions = { ...options, providerToolchains: { executionMode: 'inProcess' } };
    const providers = buildProvidersConfiguration({ providers: { executionMode: 'sharedMemoryWorker' } }, toolchainOptions, documentWithoutCppNode);
    assert.equal(providers.executionMode, 'sharedMemoryWorker');
});

test('executionMode precedence: the toolchain setting wins over the cpp-node-provider default', () => {
    const toolchainOptions = { ...options, providerToolchains: { executionMode: 'sharedMemoryWorker' } };
    const providers = buildProvidersConfiguration({}, toolchainOptions, documentWithCppNode);
    assert.equal(providers.executionMode, 'sharedMemoryWorker');
});

test('executionMode precedence: KONJUGATE_PROVIDER_EXECUTION_MODE wins over the toolchain setting but loses to an explicit override', () => {
    process.env.KONJUGATE_PROVIDER_EXECUTION_MODE = 'inProcess';
    try {
        const toolchainOptions = { ...options, providerToolchains: { executionMode: 'sharedMemoryWorker' } };
        assert.equal(buildProvidersConfiguration({}, toolchainOptions, documentWithoutCppNode).executionMode, 'inProcess');
        assert.equal(buildProvidersConfiguration({ providers: { executionMode: 'sharedMemoryWorker' } }, toolchainOptions, documentWithoutCppNode).executionMode, 'sharedMemoryWorker');
    } finally {
        delete process.env.KONJUGATE_PROVIDER_EXECUTION_MODE;
    }
});
