import test from 'node:test';
import assert from 'node:assert/strict';
import {filterExpenses,recordedSummary,recentMonths,channels,money} from './billing/model.ts';
import {categories} from './constants.ts';
const expenses=[{id:'a',category:'电费',cents:12345,date:'2026-11-01',note:''},{id:'b',category:'水费',cents:2900,date:'2026-11-16',note:''},{id:'c',category:'电费',cents:10000,date:'2026-10-01',note:''},{id:'d',category:'电费',cents:1,date:'2027-01-01',note:''}];
test('record totals stay in cents, month/category filters combine and do not mutate SSE source',()=>{
 const original=structuredClone(expenses);const selected=filterExpenses(expenses,'2026-11','all');assert.deepEqual(selected.map(e=>e.id),['b','a']);assert.equal(recordedSummary(selected).cents,15245);assert.equal(recordedSummary(selected).count,2);assert.deepEqual(filterExpenses(expenses,'2026-11','电费').map(e=>e.id),['a']);assert.equal(filterExpenses(expenses,'','电费').length,3);assert.deepEqual(expenses,original);assert.match(money(1),/0\.01/);
});
test('empty periods remain distinguishable from recorded totals and six months cross year boundaries',()=>{
 const empty=recordedSummary([]);assert.equal(empty.count,0);assert.equal(empty.categories.every(c=>c.count===0),true);
 const months=recentMonths(expenses,'2027-01');assert.deepEqual(months.map(m=>m.key),['2026-08','2026-09','2026-10','2026-11','2026-12','2027-01']);assert.equal(months[0].count,0);assert.equal(months[5].cents,1);
});
test('all fee categories have explicit provider destinations and local service scope',()=>{assert.deepEqual(Object.keys(channels),[...categories]);for(const c of categories)assert.match(channels[c].href,/^https?:\/\//);assert.equal(channels['水费'].area,'杭州');assert.equal(channels['燃气费'].area,'杭州');});
