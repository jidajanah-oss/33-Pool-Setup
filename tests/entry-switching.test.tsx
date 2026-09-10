// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useCloudEnrollment } from '../src/features/enrollment/useCloudEnrollment';
import { useCloudPayments } from '../src/features/payments/useCloudPayments';
import type { CloudClaim, CloudProfile } from '../src/types/cloud';
const mocks = vi.hoisted(()=>({claims:vi.fn(),schedule:vi.fn(),account:vi.fn(),transactions:vi.fn()}));
vi.mock('../src/services/cloudPoolService',()=>({
  fetchMyClaims:mocks.claims,fetchMySchedule:mocks.schedule,fetchPoolStatus:async()=>({current_week:1}),
  fetchCommissionerExists:async()=>false,fetchNumberBoard:async()=>[],
  bootstrapPrimaryCommissioner:vi.fn(),claimCloudNumber:vi.fn(),fetchWeeklyBoard:vi.fn(),
  publishCloudSchedule:vi.fn(),releaseCloudNumber:vi.fn(),setCloudEnrollmentOpen:vi.fn(),updateCloudDisplayName:vi.fn(),
}));
vi.mock('../src/services/cloudPaymentService',()=>({
  fetchMyPaymentAccount:mocks.account,fetchPaymentTransactionsForUid:mocks.transactions,
  fetchCommissionerPaymentAccounts:async()=>[],recordCloudPaymentTransaction:vi.fn(),
}));
const profile={id:'mitch',display_name:'Mitch',role:'player',created_at:'',updated_at:''} as CloudProfile;
const claims:CloudClaim[]=[{entry_id:'mitch',player_name:'Mitch',schedule_number:24,claimed_at:''},
  {entry_id:'erin',player_name:'Mitch2',schedule_number:19,claimed_at:''}];
beforeEach(()=>{
  vi.clearAllMocks(); mocks.claims.mockResolvedValue(claims);
  mocks.schedule.mockImplementation(async(n:number)=>[{week:1,teamCode:`LINE${n}`}]);
  mocks.account.mockImplementation(async(_week:number,uid:string)=>({uid,amount_paid_cents:uid==='mitch'?2100:5400}));
  mocks.transactions.mockImplementation(async(uid:string)=>[{id:`history-${uid}`}]);
});
afterEach(cleanup);
test('switches names, schedules, and independent balances; selection survives refresh',async()=>{
  const {result}=renderHook(()=>{const cloud=useCloudEnrollment(profile);const payments=useCloudPayments(profile,1,false,cloud.ownClaim?.entry_id);return {cloud,payments};});
  await waitFor(()=>expect(result.current.payments.myAccount?.uid).toBe('mitch'));
  act(()=>result.current.cloud.selectEntry('erin'));
  await waitFor(()=>expect(result.current.payments.myAccount?.uid).toBe('erin'));
  expect(result.current.cloud.ownClaim?.player_name).toBe('Mitch2');
  expect(result.current.cloud.ownSchedule[0].teamCode).toBe('LINE19');
  expect(result.current.payments.myAccount?.amount_paid_cents).toBe(5400);
  expect(result.current.payments.myTransactions[0].id).toBe('history-erin');
  await act(()=>result.current.cloud.refresh());
  expect(result.current.cloud.ownClaim?.entry_id).toBe('erin');
});
test('unowned IDs cannot be selected and revoked entries are removed on refresh',async()=>{
  const {result}=renderHook(()=>useCloudEnrollment(profile));
  await waitFor(()=>expect(result.current.ownClaim?.entry_id).toBe('mitch'));
  act(()=>result.current.selectEntry('stranger'));
  expect(result.current.ownClaim?.entry_id).toBe('mitch');
  act(()=>result.current.selectEntry('erin'));
  await waitFor(()=>expect(result.current.ownClaim?.entry_id).toBe('erin'));
  mocks.claims.mockResolvedValue([claims[0]]);
  await act(()=>result.current.refresh());
  expect(result.current.ownClaim?.entry_id).toBe('mitch');
});
test('late payment responses cannot overwrite the selected entry',async()=>{
  let finish:(v:unknown)=>void=()=>{};
  mocks.account.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const {result,rerender}=renderHook(({entry})=>useCloudPayments(profile,1,false,entry),{initialProps:{entry:'mitch'}});
  rerender({entry:'erin'});
  await waitFor(()=>expect(result.current.myAccount?.uid).toBe('erin'));
  await act(async()=>finish({uid:'mitch',amount_paid_cents:2100}));
  expect(result.current.myAccount?.uid).toBe('erin');
});
test('late schedule responses cannot overwrite a newer selection',async()=>{
  const {result}=renderHook(()=>useCloudEnrollment(profile));
  await waitFor(()=>expect(result.current.ownClaim?.entry_id).toBe('mitch'));
  let finish:(v:unknown)=>void=()=>{};
  mocks.schedule.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  act(()=>result.current.selectEntry('erin'));
  await waitFor(()=>expect(mocks.schedule).toHaveBeenCalledWith(19));
  act(()=>result.current.selectEntry('mitch'));
  await waitFor(()=>expect(result.current.ownClaim?.entry_id).toBe('mitch'));
  await act(async()=>finish([{week:1,teamCode:'STALE19'}]));
  expect(result.current.ownSchedule[0].teamCode).toBe('LINE24');
});
