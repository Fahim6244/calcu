import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePlate,classifyPlate,importReference} from '../lib/plates.mjs';
const snapshot={records:{'0003MMT':{category:'urbana'},'0052NHT':{category:'outside_amb'},'0197MCL':{category:'outside_catalunya'}},sourceDate:'2026-09-21'};
test('classification follows exact approved mappings',()=>{
 assert.equal(normalizePlate(' 0052 nht '),'0052NHT');
 assert.equal(classifyPlate('0052NHT',snapshot).color,'yellow');
 assert.equal(classifyPlate('0003MMT',snapshot).captureEligible,false);
 assert.equal(classifyPlate('0197MCL',snapshot).captureEligible,true);
 assert.equal(classifyPlate('0197',snapshot).state,'incomplete');
 assert.equal(classifyPlate('9999ZZZ',null).state,'unavailable');
 assert.equal(classifyPlate('9999ZZZ',snapshot).category,'unknown');
});
test('duplicates preserve provenance and conflicts never enable camera',()=>{
 const r=importReference([{plate:'0003MMT',category:'urbana',info:'A'},{plate:'0003 MMT',category:'outside_catalunya',info:'B'}]);
 assert.equal(r.conflicts.length,1); assert.equal(r.records['0003MMT'].sources.length,2);
 assert.equal(classifyPlate('0003MMT',r).captureEligible,false);
});
