import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERIN_ENTRY, MITCH_OWNER, validateTransfer, transferUpdates, stableJson, type TransferRecords } from '../src/services/entryTransferPlan.ts';
import { entryOwner } from '../src/services/entryOwnership.ts';
function fixture(): TransferRecords {
  const records: TransferRecords = {'poolConfig/main':{season:2026,seasonLaunched:true,schedulesLocked:true,numberSelectionOpen:false,scheduleId:'33P-2026-AEDA92D101'}};
  for (const [uid,line,name,email] of [[ERIN_ENTRY,'19','Erin','erin@example.com'],[MITCH_OWNER,'24','Mitch','bball1112@msn.com']]) {
    const claim={uid,lineId:line,playerName:name,claimedAt:'original'};
    records[`claims/${line}`]={...claim}; records[`userClaims/${uid}`]={...claim};
    records[`users/${uid}`]={uid,email,displayName:name};
    records[`payments/${uid}`]={uid,scheduleNumber:Number(line),amountPaidCents:5400};
    records[`privateSchedules/${line}`]={scheduleId:'33P-2026-AEDA92D101',assignments:Array.from({length:18},(_,i)=>({week:i+1,teamCode:`TEAM${i}`}))};
  } return records;
}
test('legacy ownership works and explicit owner replaces it',()=>{
  assert.equal(entryOwner({uid:ERIN_ENTRY}),ERIN_ENTRY);
  assert.equal(entryOwner({uid:ERIN_ENTRY,ownerUid:MITCH_OWNER}),MITCH_OWNER);
  assert.equal(entryOwner({uid:ERIN_ENTRY,ownerUid:''}),'');
});
test('transfer preserves original IDs, amounts, timestamps, and all schedule assignments',()=>{
  const records=fixture(), before=structuredClone(records); validateTransfer(records);
  for(const [path,patch] of Object.entries(transferUpdates())) Object.assign(records[path],patch);
  assert.deepEqual(Object.keys(transferUpdates()),['claims/19',`userClaims/${ERIN_ENTRY}`]);
  for(const path of Object.keys(records)) {
    const expected={...before[path],...(transferUpdates() as TransferRecords)[path]};
    assert.deepEqual(records[path],expected);
  }
  assert.equal(entryOwner(records['claims/19']),MITCH_OWNER);
  assert.equal(records['claims/19'].uid,ERIN_ENTRY);
  assert.throws(()=>validateTransfer(records));
});
for(const [label,change] of Object.entries({
  'wrong email':(r:TransferRecords)=>r[`users/${MITCH_OWNER}`].email='wrong@msn.com',
  'wrong UID':(r:TransferRecords)=>r['claims/19'].uid='someone-else',
  'wrong number':(r:TransferRecords)=>r['claims/19'].lineId='24',
  'changed owner':(r:TransferRecords)=>r['claims/19'].ownerUid='someone-else',
  'missing ledger':(r:TransferRecords)=>delete r[`payments/${ERIN_ENTRY}`],
  'different pull':(r:TransferRecords)=>r['poolConfig/main'].scheduleId='new-pull',
  'open season':(r:TransferRecords)=>r['poolConfig/main'].numberSelectionOpen=true,
  'duplicate weeks':(r:TransferRecords)=>r['privateSchedules/19'].assignments=Array(18).fill({week:1}),
  'mismatched index':(r:TransferRecords)=>r[`userClaims/${ERIN_ENTRY}`].claimedAt='changed',
})) test(`refuses ${label}`,()=>{const r=fixture();change(r);assert.throws(()=>validateTransfer(r));});
test('fingerprint serialization does not depend on object key order',()=>assert.equal(stableJson({b:2,a:1}),stableJson({a:1,b:2})));
