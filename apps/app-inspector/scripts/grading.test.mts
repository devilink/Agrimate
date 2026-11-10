// Run with: node scripts/grading.test.mts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidScale, missingForMark, outOfSpecLabels, parseReading, readingsPayload, readingState, specText } from '../src/lib/grading.ts';

const moisture = { key: 'moisture', label: 'Moisture', unit: '%', min: 8, max: 14, required: true };
const foreign = { key: 'foreignMatter', label: 'Foreign matter', unit: '%', max: 2, required: false };
const spec = [moisture, foreign];

test('marks readings as the inspector types', () => {
  assert.equal(readingState(moisture, ''), 'empty');
  assert.equal(readingState(moisture, '1'), 'out-of-spec');
  assert.equal(readingState(moisture, '12.'), 'invalid');
  assert.equal(readingState(moisture, '12.5'), 'in-spec');
  assert.equal(readingState(moisture, '14'), 'in-spec');
  assert.equal(readingState(moisture, '14.1'), 'out-of-spec');
  assert.equal(readingState(moisture, 'abc'), 'invalid');
  assert.equal(readingState(moisture, '12,5'), 'in-spec');
  assert.equal(parseReading('12,5'), 12.5);
});

test('shows the spec range in words', () => {
  assert.equal(specText(moisture), 'Allowed: 8 to 14 %');
  assert.equal(specText(foreign), 'Allowed: at most 2 %');
  assert.equal(specText({ ...moisture, min: undefined, max: undefined }), 'No limit set for this grade');
});

test('builds the API body with numbers only and leaves out empty optional fields', () => {
  assert.deepEqual(readingsPayload(spec, { moisture: '12.5', foreignMatter: '' }), { moisture: 12.5 });
  assert.deepEqual(readingsPayload(spec, { moisture: '12.5', foreignMatter: '1', stray: '9' }), { moisture: 12.5, foreignMatter: 1 });
});

test('scale reading must be a whole number of at least 1 kg, as the API requires', () => {
  assert.ok(isValidScale('9900'));
  assert.ok(!isValidScale('0'));
  assert.ok(!isValidScale(''));
  assert.ok(!isValidScale('12.5'));
});

test('explains everything that blocks Mark as Inspected', () => {
  const blocked = missingForMark({ checkedIn: false, spec, values: {}, scale: '', photoCount: 0, online: false });
  assert.deepEqual(blocked, ['Check in at the pickup point.', 'Enter Moisture.', 'Enter the weighing-scale reading in whole kg.', 'Take at least one photo.', 'Connect to the internet to send the inspection.']);
});

test('optional fields do not block; a bad optional value does', () => {
  const base = { checkedIn: true, spec, scale: '100', photoCount: 1, online: true };
  assert.deepEqual(missingForMark({ ...base, values: { moisture: '10' } }), []);
  assert.deepEqual(missingForMark({ ...base, values: { moisture: '10', foreignMatter: 'x' } }), ['Foreign matter must be a number.']);
});

test('out-of-spec values do not block sending, because that is how a failed grade gets reported', () => {
  const values = { moisture: '30', foreignMatter: '5' };
  assert.deepEqual(missingForMark({ checkedIn: true, spec, values, scale: '100', photoCount: 1, online: true }), []);
  assert.deepEqual(outOfSpecLabels(spec, values), ['Moisture', 'Foreign matter']);
});
