import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateServerConsoleAccess,
  isCloudRunPreviewHost,
  isLoopbackIp,
  isPrivateLanIp,
} from './serverConsoleAccess';

test('direct loopback localhost requests are authorized as PC Server Console', () => {
  assert.equal(
    evaluateServerConsoleAccess({
      remoteAddress: '127.0.0.1',
      hostHeader: 'localhost:3000',
      isCloudRunRuntime: false,
    }),
    true
  );
  assert.equal(
    evaluateServerConsoleAccess({
      remoteAddress: '::ffff:127.0.0.1',
      hostHeader: '127.0.0.1:3000',
      isCloudRunRuntime: false,
    }),
    true
  );
  assert.equal(
    evaluateServerConsoleAccess({
      remoteAddress: '::1',
      hostHeader: '[::1]:3000',
      isCloudRunRuntime: false,
    }),
    true
  );
});

test('private RFC-1918 LAN clients are strictly blocked as Browser Clients', () => {
  // Simulated LAN workstation via X-Forwarded-For (matches stress security test)
  assert.equal(
    evaluateServerConsoleAccess({
      remoteAddress: '127.0.0.1',
      hostHeader: '127.0.0.1:3000',
      forwardedFor: '192.168.1.55',
      isCloudRunRuntime: true,
    }),
    false
  );
  // Direct LAN socket connection on on-premise server
  assert.equal(
    evaluateServerConsoleAccess({
      remoteAddress: '192.168.1.42',
      hostHeader: '192.168.1.10:3000',
      isCloudRunRuntime: false,
    }),
    false
  );
  assert.equal(
    evaluateServerConsoleAccess({
      remoteAddress: '10.0.2.15',
      hostHeader: '10.0.2.1:3000',
      isCloudRunRuntime: false,
    }),
    false
  );
  assert.equal(
    evaluateServerConsoleAccess({
      remoteAddress: '172.16.4.9',
      hostHeader: 'ledger-server.local:3000',
      isCloudRunRuntime: false,
    }),
    false
  );
  // Even on Cloud Run host, explicit private LAN forwarded client IP stays blocked
  assert.equal(
    evaluateServerConsoleAccess({
      remoteAddress: '169.254.1.1',
      hostHeader: 'ais-dev-example.asia-southeast1.run.app',
      forwardedFor: '192.168.1.55, 34.117.59.81',
      isCloudRunRuntime: true,
    }),
    false
  );
});

test('non-loopback forwarded public IP on on-premise host is blocked', () => {
  assert.equal(
    evaluateServerConsoleAccess({
      remoteAddress: '127.0.0.1',
      hostHeader: 'localhost:3000',
      forwardedFor: '203.0.113.25',
      isCloudRunRuntime: false,
    }),
    false
  );
  assert.equal(
    evaluateServerConsoleAccess({
      remoteAddress: '127.0.0.1',
      hostHeader: 'erp.company.ph',
      forwardedFor: '203.0.113.25',
      isCloudRunRuntime: false,
    }),
    false
  );
});

test('hosted AI Studio Cloud Run preview grants PC Server Console access across Envoy/GFE internal proxy IPs', () => {
  assert.equal(
    isCloudRunPreviewHost('ais-dev-5xzsptc5nfi5i6eqcoo2va-343881880269.asia-southeast1.run.app'),
    true
  );
  // Real Cloud Run Envoy sidecar connects from 169.254.x.x or 10.x.x.x with internal hop in X-Forwarded-For
  assert.equal(
    evaluateServerConsoleAccess({
      remoteAddress: '::ffff:169.254.1.1',
      hostHeader: 'ais-dev-5xzsptc5nfi5i6eqcoo2va-343881880269.asia-southeast1.run.app',
      forwardedFor: '112.201.44.18, 10.128.0.5, 34.117.59.81',
      isCloudRunRuntime: true,
    }),
    true
  );
  // Cloud Run proxy rewriting Host to localhost:3000 with public client IP
  assert.equal(
    evaluateServerConsoleAccess({
      remoteAddress: '::ffff:10.128.0.2',
      hostHeader: 'localhost:3000',
      forwardedFor: '112.201.44.18',
      isCloudRunRuntime: true,
    }),
    true
  );
  // Explicitly disabled via env flag
  assert.equal(
    evaluateServerConsoleAccess({
      remoteAddress: '::ffff:169.254.1.1',
      hostHeader: 'ais-dev-5xzsptc5nfi5i6eqcoo2va-343881880269.asia-southeast1.run.app',
      forwardedFor: '112.201.44.18',
      hostedPreviewAllowed: false,
      isCloudRunRuntime: true,
    }),
    false
  );
});

test('IP classification helpers accurately distinguish loopback and private LAN ranges', () => {
  assert.equal(isLoopbackIp('127.0.0.1'), true);
  assert.equal(isLoopbackIp('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackIp('192.168.1.1'), false);

  assert.equal(isPrivateLanIp('192.168.1.55'), true);
  assert.equal(isPrivateLanIp('10.24.0.1'), true);
  assert.equal(isPrivateLanIp('172.16.0.5'), true);
  assert.equal(isPrivateLanIp('172.31.255.254'), true);
  assert.equal(isPrivateLanIp('172.32.0.1'), false);
  assert.equal(isPrivateLanIp('112.201.44.18'), false);
});
