import assert from 'node:assert/strict';
import test from 'node:test';
import { postcodeFor } from '../js/brussels-postcodes.js';

test('Brussels neighbourhood labels use Belgian postcodes and their actual communes', () => {
  assert.deepEqual(postcodeFor('Pentagon'), { postcode: '1000', borough: 'City of Brussels' });
  assert.deepEqual(postcodeFor('Laeken'), { postcode: '1020', borough: 'City of Brussels' });
  assert.deepEqual(postcodeFor('Flagey'), { postcode: '1050', borough: 'Ixelles' });
  assert.deepEqual(postcodeFor('Parvis de Saint-Gilles'), { postcode: '1060', borough: 'Saint-Gilles' });
  assert.deepEqual(postcodeFor('Molenbeek-Saint-Jean'), { postcode: '1080', borough: 'Molenbeek-Saint-Jean' });
  assert.deepEqual(postcodeFor('Sint-Lambrechts-Woluwe'), { postcode: '1200', borough: 'Woluwe-Saint-Lambert' });
});

test('Brussels postcode lookup is case- and accent-insensitive', () => {
  assert.deepEqual(postcodeFor('SCHAERBEEK'), { postcode: '1030', borough: 'Schaerbeek' });
  assert.deepEqual(postcodeFor('Saint-Josse-ten-Noode'), { postcode: '1210', borough: 'Saint-Josse-ten-Noode' });
});

test('unknown names do not receive fabricated London postcode districts', () => {
  assert.deepEqual(postcodeFor('Westminster'), { postcode: '', borough: '' });
  assert.deepEqual(postcodeFor('Wezembeek-Oppem'), { postcode: '', borough: '' });
});
