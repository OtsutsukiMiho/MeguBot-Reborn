'use strict';
const assert = require('node:assert/strict');
const { parseDirectoryFilters: parse, serializeDirectoryFilters: serialize } = require('../core/project-directory-filters');
assert.deepEqual(parse(''), { query: '', bucket: 'active', mine: false, scope: 'all', server: '', cursor: '' });
const filters = { query: 'งาน & design', bucket: 'closed', mine: true, scope: 'tem_example', server: '467655562658578432', cursor: 'next+page/='  };
assert.deepEqual(parse(serialize(filters)), filters);
assert.equal(parse('?team=standalone').scope, 'standalone');
assert.equal(parse('?team=tem_example', false).scope, 'all');
assert.equal(parse('?server=467655562658578432', false).server, '');
assert.equal(parse('?server=invalid').server, '');
assert.equal(parse('?bucket=anything&assigned=false').bucket, 'active');
assert.equal(parse('?bucket=anything&assigned=false').mine, false);
assert.equal(parse(`?q=${'x'.repeat(121)}`).query.length, 120);
assert.equal(serialize(parse('')), '');
console.log('Project directory filter URL round-trips passed');

assert.equal(parse('?cursor=' + 'x'.repeat(501)).cursor.length, 500);
