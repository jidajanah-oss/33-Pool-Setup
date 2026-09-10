import { beforeAll, afterAll, expect, test, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { ERIN_ENTRY, MITCH_OWNER, TRANSFER_ID } from '../src/services/entryTransferPlan';
const state=vi.hoisted(()=>({db:null as unknown,user:{uid:'primary',email:'jidajanah@gmail.com'}}));
vi.mock('../src/lib/firebase',()=>({requireFirestore:()=>state.db,requireFirebaseAuth:()=>({currentUser:state.user})}));
vi.mock('../src/services/cloudRoleService',()=>({requireCloudPrimary:async()=>{if(state.user.uid!=='primary')throw new Error('Primary required');}}));
import { prepareErinTransfer, applyErinTransfer, verifyErinTransfer, rollbackErinTransfer } from '../src/services/cloudEntryTransferService';
let env:Awaited<ReturnType<typeof initializeTestEnvironment>>;
beforeAll(async()=>{
  env=await initializeTestEnvironment({projectId:'demo-33pool-migration',firestore:{host:'127.0.0.1',port:8080,rules:await readFile('firestore.rules','utf8')}});
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await setDoc(doc(db,'poolConfig/main'),{season:2026,seasonLaunched:true,schedulesLocked:true,numberSelectionOpen:false,scheduleId:'33P-2026-AEDA92D101'});
    for(let i=1;i<=32;i++) {
      const uid=i===19?ERIN_ENTRY:i===24?MITCH_OWNER:`entry${i}`;
      const name=i===19?'Erin':i===24?'Mitch':`Player ${i}`;
      const claim={uid,lineId:String(i),playerName:name,claimedAt:'original'};
      await setDoc(doc(db,`claims/${i}`),claim);await setDoc(doc(db,`userClaims/${uid}`),claim);
      await setDoc(doc(db,`users/${uid}`),{uid,displayName:name,email:i===24?'bball1112@msn.com':`${uid}@example.com`});
      await setDoc(doc(db,`payments/${uid}`),{uid,scheduleNumber:i,amountPaidCents:5400});
      await setDoc(doc(db,`privateSchedules/${i}`),{scheduleId:'33P-2026-AEDA92D101',assignments:Array.from({length:18},(_,n)=>({week:n+1,teamCode:`TEAM${n}`}))});
    }
    await setDoc(doc(db,'paymentTransactions/old-erin'),{uid:ERIN_ENTRY,scheduleNumber:19,amountCents:5400});
    await setDoc(doc(db,'winners/old-erin'),{uid:ERIN_ENTRY,scheduleNumber:19,payoutCents:9600});
  });
  state.db=env.authenticatedContext('primary',{email:'jidajanah@gmail.com'}).firestore();
},30000);
afterAll(async()=>{await env?.cleanup();});
test('actual transaction changes only two claim records and an audit; retries and stale plans fail',async()=>{
  const db=state.db as Parameters<typeof collection>[0];
  const preview=await prepareErinTransfer();
  await expect(applyErinTransfer(preview,'wrong')).rejects.toThrow();
  await env.withSecurityRulesDisabled(async ctx=>updateDoc(doc(ctx.firestore(),`payments/${ERIN_ENTRY}`),{amountPaidCents:5300}));
  await expect(applyErinTransfer(preview,'TRANSFER LINE 19 TO MITCH2')).rejects.toThrow('changed');
  expect((await getDoc(doc(db,'claims/19'))).data()?.playerName).toBe('Erin');
  const fresh=await prepareErinTransfer();
  const collections=['claims','userClaims','users','payments','privateSchedules','paymentTransactions','winners','poolConfig'];
  const readAll=async()=>Object.fromEntries((await Promise.all(collections.map(name=>getDocs(collection(db,name))))).flatMap(s=>s.docs.map(d=>[d.ref.path,d.data()])));
  const before=await readAll();
  await applyErinTransfer(fresh,'TRANSFER LINE 19 TO MITCH2');
  await verifyErinTransfer(fresh);
  const after=await readAll();
  const changed=Object.keys(after).filter(path=>JSON.stringify(after[path])!==JSON.stringify(before[path]));
  expect(changed.sort()).toEqual(['claims/19',`userClaims/${ERIN_ENTRY}`].sort());
  expect((await getDoc(doc(db,'audit',TRANSFER_ID))).exists()).toBe(true);
  await expect(applyErinTransfer(fresh,'TRANSFER LINE 19 TO MITCH2')).rejects.toThrow('already');
  await expect(prepareErinTransfer()).rejects.toThrow();
  await rollbackErinTransfer('RESTORE ERIN LINE 19');
  expect((await getDoc(doc(db,'claims/19'))).data()?.playerName).toBe('Erin');
  expect((await getDoc(doc(db,'claims/19'))).data()?.ownerUid).toBe(ERIN_ENTRY);
  const restored=await readAll();
  for(const path of Object.keys(before).filter(p=>!changed.includes(p))) expect(restored[path]).toEqual(before[path]);
  await expect(rollbackErinTransfer('RESTORE ERIN LINE 19')).rejects.toThrow();
},30000);
