import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
let env;
before(async () => {
  env = await initializeTestEnvironment({projectId:'demo-33pool-multi', firestore:{host:'127.0.0.1',port:8080,rules:await readFile('firestore.rules','utf8')}});
  await env.withSecurityRulesDisabled(async ctx => {
    const db=ctx.firestore();
    for(const [path,data] of Object.entries({
      'poolConfig/main':{seasonLaunched:true,numberSelectionOpen:false,schedulesLocked:true},
      'users/mitch':{uid:'mitch',displayName:'Mitch'}, 'users/erin':{uid:'erin',displayName:'Erin'},
      'claims/19':{uid:'erin',lineId:'19',playerName:'Mitch2',ownerUid:'mitch',claimedAt:'original'},
      'claims/24':{uid:'mitch',lineId:'24',playerName:'Mitch',claimedAt:'original'},
      'userClaims/erin':{uid:'erin',lineId:'19',playerName:'Mitch2',ownerUid:'mitch',claimedAt:'original'},
      'userClaims/mitch':{uid:'mitch',lineId:'24',playerName:'Mitch',claimedAt:'original'},
      'privateSchedules/19':{assignments:[{week:1,teamCode:'SEA'}]},
      'privateSchedules/24':{assignments:[{week:1,teamCode:'DAL'}]},
      'payments/erin':{uid:'erin',amountPaidCents:5400}, 'payments/mitch':{uid:'mitch',amountPaidCents:2100},
      'paymentTransactions/old-erin':{uid:'erin',scheduleNumber:19,amountCents:5400},
      'paymentTransactions/old-mitch':{uid:'mitch',scheduleNumber:24,amountCents:2100},
      'commissionerTeam/main':{backup1Uid:'backup',backup2Uid:'otherBackup'},
    })) await setDoc(doc(db,path),data);
  });
});
after(async()=>{await env?.cleanup();});
test('Mitch can read both schedules, indexes, and separate historical ledgers', async()=>{
  const db=env.authenticatedContext('mitch').firestore();
  for(const path of ['privateSchedules/19','privateSchedules/24','userClaims/erin','userClaims/mitch','payments/erin','payments/mitch']) await assertSucceeds(getDoc(doc(db,path)));
  for(const uid of ['erin','mitch']) await assertSucceeds(getDocs(query(collection(db,'paymentTransactions'),where('uid','==',uid))));
});
test('Erin loses access even though the historical ledger uid still equals her login', async()=>{
  const db=env.authenticatedContext('erin').firestore();
  for(const path of ['privateSchedules/19','privateSchedules/24','userClaims/erin','payments/erin','payments/mitch','paymentTransactions/old-erin']) await assertFails(getDoc(doc(db,path)));
  await assertFails(getDocs(query(collection(db,'paymentTransactions'),where('uid','==','erin'))));
});
test('unrelated and anonymous users cannot read private entries',async()=>{
  for(const ctx of [env.authenticatedContext('stranger'),env.unauthenticatedContext()])
    for(const path of ['privateSchedules/19','payments/erin']) await assertFails(getDoc(doc(ctx.firestore(),path)));
});
test('players cannot take ownership or modify historical transactions',async()=>{
  for(const uid of ['erin','mitch']) {
    const db=env.authenticatedContext(uid).firestore();
    await assertFails(updateDoc(doc(db,'claims/19'),{ownerUid:uid}));
    await assertFails(updateDoc(doc(db,'userClaims/erin'),{ownerUid:uid}));
    await assertFails(updateDoc(doc(db,'paymentTransactions/old-erin'),{amountCents:0}));
  }
});
test('commissioner can read both ledgers; backup cannot transfer ownership',async()=>{
  const db=env.authenticatedContext('backup').firestore();
  await assertSucceeds(getDoc(doc(db,'payments/erin')));
  await assertFails(updateDoc(doc(db,'claims/19'),{ownerUid:'erin'}));
});
test('live-season claims cannot be deleted or rekeyed, even by primary',async()=>{
  const db=env.authenticatedContext('primary',{email:'jidajanah@gmail.com'}).firestore();
  await assertFails(deleteDoc(doc(db,'claims/19')));
  await assertFails(deleteDoc(doc(db,'userClaims/erin')));
  await assertFails(updateDoc(doc(db,'claims/19'),{uid:'mitch'}));
  await assertFails(updateDoc(doc(db,'claims/19'),{ownerUid:'erin'}));
});
test('primary can atomically change both owner pointers while preserving legacy identity',async()=>{
  const db=env.authenticatedContext('primary',{email:'jidajanah@gmail.com'}).firestore();
  const batch=writeBatch(db);
  batch.update(doc(db,'claims/19'),{ownerUid:'erin',playerName:'Erin'});
  batch.update(doc(db,'userClaims/erin'),{ownerUid:'erin',playerName:'Erin'});
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(doc(env.authenticatedContext('erin').firestore(),'privateSchedules/19')));
  await assertFails(getDoc(doc(env.authenticatedContext('mitch').firestore(),'privateSchedules/19')));
});
