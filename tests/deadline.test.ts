import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readWithDeadline, ReadTimeout } from '../src/messaging/deadline.ts';

test('status reads resolve normally, time out, and safely ignore late failures', async () => {
  assert.equal(
    await readWithDeadline(Promise.resolve('enabled'), 20),
    'enabled',
  );
  let reject!: (error: Error) => void;
  const late = new Promise<string>((_, no) => {
    reject = no;
  });
  await assert.rejects(readWithDeadline(late, 10), ReadTimeout);
  reject(new Error('Late page failure'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  await assert.rejects(
    readWithDeadline(Promise.reject(new Error('Gone')), 20),
    /Gone/,
  );
});
