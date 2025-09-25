#!/usr/bin/env node
import assert from 'node:assert';
import process from 'node:process';

const BASE = process.env.BASE_URL || 'http://localhost:8080/api/dashboard';
const WINDOWS = ['24h','48h','72h','7d','30d'];

async function fetchJson(path){
  const url = `${BASE}${path}`;
  const t0 = Date.now();
  const res = await fetch(url).catch(e=>({ ok:false, status:0, error:e }));
  const dt = Date.now()-t0;
  if(!res.ok){
    console.error(`[FAIL] ${path} status=${res.status} time=${dt}ms`);
    return { ok:false, status:res.status };
  }
  const json = await res.json();
  console.log(`[OK] ${path} ${dt}ms countHints:`, Object.keys(json).filter(k=>/count|total/i.test(k)).reduce((m,k)=>(m[k]=json[k],m),{}));
  return { ok:true, json, ms:dt };
}

async function main(){
  const out = { kpis:null, perCounty:{}, new:null, recent:null, diag:{} };
  out.kpis = await fetchJson('/kpis');
  out.new = await fetchJson('/new');
  out.recent = await fetchJson('/recent');
  for(const w of WINDOWS){
    out.perCounty[w] = await fetchJson(`/per-county?window=${w}`);
    out.diag[w] = await fetchJson(`/diag?window=${w}`);
  }
  // Basic sanity assertions (non-fatal warnings instead of throws to keep script usable early)
  const diag24 = out.diag['24h'];
  if(diag24?.json){
    if(typeof diag24.json.count !== 'number') console.warn('WARN: /diag 24h missing numeric count');
  }
  // Summaries
  console.log('\nSUMMARY');
  console.log(' mode:', out.kpis?.json?.mode);
  console.log(' kpis newCountsBooked:', out.kpis?.json?.newCountsBooked);
  console.log(' per-county 24h sample:', out.perCounty['24h']?.json?.items?.slice(0,2));
  console.log(' diag buckets 24h:', out.diag['24h']?.json?.bucketDist);
  // Exit code logic
  const failures = [out.kpis,out.new,out.recent,...Object.values(out.perCounty),...Object.values(out.diag)].filter(r=>!r?.ok).length;
  if(failures){
    console.error(`Smoke test completed with ${failures} request failures.`);
    process.exitCode = 2;
  } else {
    console.log('Smoke test completed successfully.');
  }
}

main().catch(e=>{ console.error('Smoke test crashed', e); process.exit(1); });
